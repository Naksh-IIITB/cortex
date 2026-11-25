import base64
import hashlib
import re
from datetime import date, timedelta
from pathlib import Path
from core import DATA, db, rows, rank, chat
from documents import extract, chunks

PORT = 8501


def initialize():
    (DATA / "originals").mkdir(exist_ok=True)
    with db() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS docs(id INTEGER PRIMARY KEY, name TEXT, subject TEXT, topic TEXT,
          semester TEXT, tags TEXT, digest TEXT UNIQUE);
        CREATE TABLE IF NOT EXISTS passages(id INTEGER PRIMARY KEY, doc INTEGER REFERENCES docs ON DELETE CASCADE,
          section TEXT, text TEXT);
        CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY, question TEXT, answer TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS cards(id INTEGER PRIMARY KEY, subject TEXT, question TEXT, answer TEXT,
          due TEXT, interval_days INTEGER DEFAULT 0, reviews INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS edges(id INTEGER PRIMARY KEY, source TEXT, target TEXT, relation TEXT,
          UNIQUE(source,target,relation));
        """)


def search(p):
    with db() as con:
        items = rows(con, """SELECT passages.id, docs.id AS doc, name, section, text FROM passages JOIN docs
            ON passages.doc=docs.id WHERE (?='' OR subject=?) AND (?=0 OR docs.id=?)
            ORDER BY passages.id DESC""", (p.get("subject", ""),)*2 + (int(p.get("doc") or 0),)*2)
    keywords = rank(p["query"], items)
    found = rank(p["query"], keywords[:120], True, p.get("embedding")) if p.get("semantic") else keywords
    return [item for item in found if item["score"] > 0][:8]


def ask(p):
    found = search(p)
    yield {"sources": found}
    evidence = "\n\n".join(f"[D{x['id']}] {x['name']} ({x['section']})\n{x['text']}" for x in found[:5])
    answer = ""
    for token in chat(p.get("instruction", "Answer the study question.") + "\n" + p["query"], evidence, p.get("model")):
        answer += token
        yield {"token": token}
    with db() as con:
        con.execute("INSERT INTO history(question,answer) VALUES(?,?)", (p["query"], answer))


def handle(action, p, post):
    if not post:
        with db() as con:
            return {
                "documents": lambda: rows(con, "SELECT id,name,subject,topic,semester,tags FROM docs ORDER BY id DESC"),
                "cards": lambda: rows(con, "SELECT * FROM cards ORDER BY due,id"),
                "graph": lambda: rows(con, "SELECT * FROM edges ORDER BY source,target"),
                "history": lambda: rows(con, "SELECT * FROM history ORDER BY id DESC LIMIT 60"),
            }[action]()
    if action == "ask":
        return ask(p)
    if action == "search":
        return search(p)
    if action == "import":
        name = Path(p["name"]).name
        raw = base64.b64decode(p["data"], validate=True)
        digest = hashlib.sha256(raw).hexdigest()
        with db() as con:
            existing = con.execute("SELECT id FROM docs WHERE digest=?", (digest,)).fetchone()
            if existing:
                return {"id": existing[0], "duplicate": True}
            sections = list(chunks(extract(name, raw)))
            cursor = con.execute("INSERT INTO docs(name,subject,topic,semester,tags,digest) VALUES(?,?,?,?,?,?)",
                                 (name, p.get("subject", ""), p.get("topic", ""), p.get("semester", ""),
                                  p.get("tags", ""), digest))
            doc = cursor.lastrowid
            con.executemany("INSERT INTO passages(doc,section,text) VALUES(?,?,?)",
                            [(doc, section, text) for section, text in sections])
            (DATA / "originals" / digest).write_bytes(raw)
        return {"id": doc, "passages": len(sections)}
    with db() as con:
        if action in {"preview", "original"}:
            doc = dict(con.execute("SELECT * FROM docs WHERE id=?", (int(p["id"]),)).fetchone() or {})
            if not doc:
                raise ValueError("Document missing.")
            if action == "original":
                return {"name": doc["name"], "data": base64.b64encode((DATA / "originals" / doc["digest"]).read_bytes()).decode()}
            return rows(con, "SELECT section,text FROM passages WHERE doc=? LIMIT 40", (doc["id"],))
        if action == "delete-doc":
            row = con.execute("SELECT digest FROM docs WHERE id=?", (int(p["id"]),)).fetchone()
            if row:
                con.execute("DELETE FROM docs WHERE id=?", (int(p["id"]),))
                (DATA / "originals" / row[0]).unlink(missing_ok=True)
                if con.execute("SELECT 1 FROM sqlite_master WHERE name='vectors'").fetchone():
                    con.execute("DELETE FROM vectors")
        elif action == "card":
            con.execute("INSERT INTO cards(subject,question,answer,due) VALUES(?,?,?,?)",
                        (p.get("subject", ""), p["question"], p["answer"], date.today().isoformat()))
        elif action == "review":
            row = con.execute("SELECT interval_days FROM cards WHERE id=?", (int(p["id"]),)).fetchone()
            if not row:
                raise ValueError("Card missing.")
            days = max(2, row[0] * 2) if p.get("remembered") else 1
            con.execute("UPDATE cards SET interval_days=?,due=?,reviews=reviews+1 WHERE id=?",
                        (days, (date.today()+timedelta(days=days)).isoformat(), int(p["id"])))
        elif action == "edge":
            con.execute("INSERT OR IGNORE INTO edges(source,target,relation) VALUES(?,?,?)",
                        (p["source"], p["target"], p["relation"]))
        elif action == "delete-edge":
            con.execute("DELETE FROM edges WHERE id=?", (int(p["id"]),))
        else:
            raise ValueError("Unknown action.")
    return {"ok": True}

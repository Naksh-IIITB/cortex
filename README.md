# CORTEX

A local knowledge workspace for coursework and research.

- Import and organize course material
- Search cited passages and ask local Ollama
- Review flashcards and explore concept relationships

## Run locally

Install Python 3.11+ and clone or download this repository. For Git imports, install Git.
Ollama is optional for the offline workflows. For AI, start Ollama with local models such as
Qwen3 4B and Nomic Embed Text.

    sh install.sh
    sh run.sh

Open http://127.0.0.1:8501. Ctrl+C stops the server.
Run \`python3 test_workflows.py\` for the workflow test.

## Scope

Image OCR, automatic graph writes, and exam scheduling are outside this release. Generated study material is returned as text. Add selected flashcards and graph relationships manually.
The semantic search reranks up to 120 keyword-ranked candidates. AI output can be incomplete
and should be checked against the displayed evidence.

## Local data

Data is stored in \`data/\` (or \`APP_DATA_DIR\` if set). Stop the app before backing it up:

    python3 backup.py backup /absolute/path/to/new-backup
    python3 backup.py restore /absolute/path/to/existing-backup

Restore requires the data directory to be absent. To uninstall, stop the app, back up data you
want to keep, and remove the project folder. The public landing page contains project information.

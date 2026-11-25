import AppKit
import PDFKit
import Vision

func requestForOCR() -> VNRecognizeTextRequest {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    return request
}

func recognize(_ image: CGImage) throws -> String {
    let request = requestForOCR()
    try VNImageRequestHandler(cgImage: image).perform([request])
    return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}

do {
    let url = URL(fileURLWithPath: CommandLine.arguments[1])
    if CommandLine.arguments.count >= 3 {
        guard let document = PDFDocument(url: url),
              let number = Int(CommandLine.arguments[2]),
              let page = document.page(at: number - 1) else { throw CocoaError(.fileReadCorruptFile) }
        let bounds = page.bounds(for: .mediaBox)
        guard bounds.width > 0, bounds.height > 0 else { throw CocoaError(.fileReadCorruptFile) }
        let scale = 2000 / max(bounds.width, bounds.height)
        let image = page.thumbnail(of: CGSize(width: bounds.width * scale, height: bounds.height * scale), for: .mediaBox)
        guard let pixels = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { throw CocoaError(.fileReadCorruptFile) }
        if CommandLine.arguments.count == 4 {
            let bitmap = NSBitmapImageRep(cgImage: pixels)
            guard let png = bitmap.representation(using: .png, properties: [:]) else { throw CocoaError(.fileWriteUnknown) }
            try png.write(to: URL(fileURLWithPath: CommandLine.arguments[3]), options: .atomic)
        } else {
            print(try recognize(pixels))
        }
    } else {
        let request = requestForOCR()
        try VNImageRequestHandler(url: url).perform([request])
        print((request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n"))
    }
} catch {
    FileHandle.standardError.write(Data((String(reflecting: error) + "\n").utf8))
    exit(1)
}

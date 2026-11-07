import Foundation
import WebKit

/// Serves the bundled `Game/` folder under `antarktika://localhost/`.
/// Read-only, bundle-only: any path that resolves outside `Game/` is answered with 404.
final class GameAssetSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "antarktika"
    static let startURL = URL(string: "antarktika://localhost/index.html")!

    private let root: URL = (Bundle.main.resourceURL ?? Bundle.main.bundleURL)
        .appendingPathComponent("Game", isDirectory: true).standardizedFileURL

    private static let mimeTypes: [String: String] = [
        "html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8", "css": "text/css; charset=utf-8",
        "json": "application/json", "glb": "model/gltf-binary", "png": "image/png", "jpg": "image/jpeg",
        "jpeg": "image/jpeg", "webp": "image/webp", "svg": "image/svg+xml", "mp3": "audio/mpeg", "m4a": "audio/mp4",
        "wav": "audio/wav", "ogg": "audio/ogg", "wasm": "application/wasm", "txt": "text/plain; charset=utf-8",
    ]

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL)); return
        }
        var relative = url.path
        if relative.isEmpty || relative == "/" { relative = "/index.html" }
        let file = root.appendingPathComponent(String(relative.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/"),
              let data = try? Data(contentsOf: file, options: .mappedIfSafe) else {
            let notFound = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Length": "0"])!
            urlSchemeTask.didReceive(notFound)
            urlSchemeTask.didFinish()
            return
        }
        let mime = Self.mimeTypes[file.pathExtension.lowercased()] ?? "application/octet-stream"
        let headers = ["Content-Type": mime, "Content-Length": String(data.count), "Cache-Control": "no-cache",
                       "Access-Control-Allow-Origin": "antarktika://localhost"]
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // Responses are delivered synchronously in start(); nothing to cancel.
    }
}

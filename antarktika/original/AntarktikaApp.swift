import SwiftUI
import WebKit

@main
struct AntarktikaApp: App {
    var body: some Scene { WindowGroup { GameView().ignoresSafeArea() } }
}
struct GameView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.websiteDataStore = .default()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.scrollView.isScrollEnabled = false
        view.isOpaque = false
        view.backgroundColor = .black
        context.coordinator.webView = view
        context.coordinator.observeLifecycle()
        if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Game") {
            view.loadFileURL(url, allowingReadAccessTo: url)
        }
        return view
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
    final class Coordinator: NSObject, WKNavigationDelegate {
        weak var webView: WKWebView?
        func observeLifecycle() {
            NotificationCenter.default.addObserver(self, selector: #selector(pause), name: UIApplication.willResignActiveNotification, object: nil)
        }
        @objc func pause() {
            webView?.evaluateJavaScript("window.dispatchEvent(new Event('blur'))", completionHandler: nil)
        }
        deinit { NotificationCenter.default.removeObserver(self) }
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
            if url.isFileURL { decisionHandler(.allow) } else { decisionHandler(.cancel) }
        }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            // A reload loses the active expedition; device memory tests are required.
            webView.reload()
        }
    }
}

import SwiftUI
import UIKit
import WebKit

/// Hosts the WebGL game in a WKWebView.
///
/// - Every game file is served from the app bundle through `antarktika://localhost/…`
///   (`GameAssetSchemeHandler`), so the game is fully offline and `fetch()` of the
///   GLB models is same-origin. `file://` URLs would block those requests.
/// - Saves are mirrored to a native file (`SaveStore`) and injected back at launch,
///   so progress survives app restarts even if WebKit purges website data.
struct GameView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let coordinator = context.coordinator
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.websiteDataStore = .default()
        configuration.setURLSchemeHandler(coordinator.assets, forURLScheme: GameAssetSchemeHandler.scheme)
        configuration.userContentController.add(WeakScriptMessageHandler(coordinator), name: "antarktikaSave")
        coordinator.installSaveScript(into: configuration.userContentController)

        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = coordinator
        view.uiDelegate = coordinator
        view.allowsLinkPreview = false
        view.allowsBackForwardNavigationGestures = false
        view.scrollView.isScrollEnabled = false
        view.scrollView.bounces = false
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.isOpaque = false
        view.backgroundColor = .black
        #if DEBUG
        if #available(iOS 16.4, *) { view.isInspectable = true }   // Safari Web Inspector for device profiling
        #endif
        coordinator.webView = view
        coordinator.observeLifecycle()
        view.load(URLRequest(url: GameAssetSchemeHandler.startURL))
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        weak var webView: WKWebView?
        let assets = GameAssetSchemeHandler()

        func observeLifecycle() {
            let center = NotificationCenter.default
            center.addObserver(self, selector: #selector(pauseAndSave), name: UIApplication.willResignActiveNotification, object: nil)
            center.addObserver(self, selector: #selector(pauseAndSave), name: UIApplication.didEnterBackgroundNotification, object: nil)
        }

        deinit { NotificationCenter.default.removeObserver(self) }

        /// Pauses the expedition (the engine pauses on `blur`) and writes a save immediately.
        @objc func pauseAndSave() {
            webView?.evaluateJavaScript("window.dispatchEvent(new Event('blur'));window.ANTARKTIKA_SAVE&&window.ANTARKTIKA_SAVE.save('background');", completionHandler: nil)
        }

        /// Injects the newest native save before any page script runs.
        func installSaveScript(into controller: WKUserContentController) {
            controller.removeAllUserScripts()
            let literal = SaveStore.shared.load().flatMap(SaveStore.javaScriptStringLiteral) ?? "null"
            let source = "window.__ANTARKTIKA_NATIVE_SAVE__=\(literal);"
            controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }

        // MARK: WKScriptMessageHandler — saves posted by js/save.js
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "antarktikaSave", let body = message.body as? String else { return }
            if body.isEmpty { SaveStore.shared.clear() } else { SaveStore.shared.store(body) }
        }

        // MARK: WKNavigationDelegate
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
            if url.scheme == GameAssetSchemeHandler.scheme { decisionHandler(.allow); return }
            if ["http", "https"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
            decisionHandler(.cancel)
        }

        /// WebKit killed the web process (usually memory pressure): reload with the latest
        /// save injected, so the menu offers "DEVAM ET" at the last autosave.
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            installSaveScript(into: webView.configuration.userContentController)
            webView.load(URLRequest(url: GameAssetSchemeHandler.startURL))
        }

        // MARK: WKUIDelegate — links with target=_blank open in Safari
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = navigationAction.request.url, ["http", "https"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
            return nil
        }
    }
}

/// Breaks the WKUserContentController → handler retain cycle.
final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}

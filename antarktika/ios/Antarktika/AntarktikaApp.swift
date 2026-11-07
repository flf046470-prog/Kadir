import AVFoundation
import SwiftUI

@main
struct AntarktikaApp: App {
    init() {
        // Game audio respects the ring/silent switch and mixes with the player's music.
        try? AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    var body: some Scene {
        WindowGroup {
            GameView()
                .ignoresSafeArea()
                .background(Color.black)
                .statusBarHidden(true)
                .persistentSystemOverlays(.hidden)
        }
    }
}

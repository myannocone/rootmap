import StoreKit
import Capacitor

@objc(OfferCodeRedemptionPlugin)
public class OfferCodeRedemptionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OfferCodeRedemptionPlugin"
    public let jsName = "OfferCodeRedemption"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "presentOfferCodeRedeemSheet", returnType: CAPPluginReturnPromise)
    ]

    @objc func presentOfferCodeRedeemSheet(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.presentSheet(call)
        }
    }

    private func presentSheet(_ call: CAPPluginCall) {
        if #available(iOS 16.0, *) {
            guard let scene = foregroundWindowScene() else {
                call.reject("Offer code redemption could not open.")
                return
            }
            Task { @MainActor in
                do {
                    try await AppStore.presentOfferCodeRedeemSheet(in: scene)
                    call.resolve(["presented": true])
                } catch {
                    let text = error.localizedDescription
                    if text.range(of: "cancel", options: .caseInsensitive) != nil {
                        call.reject("Offer code redemption was cancelled.", "1")
                    } else {
                        call.reject(text.isEmpty ? "Offer code redemption could not open." : text)
                    }
                }
            }
            return
        }

        SKPaymentQueue.default().presentCodeRedemptionSheet()
        call.resolve(["presented": true])
    }

    private func foregroundWindowScene() -> UIWindowScene? {
        if let scene = bridge?.viewController?.view.window?.windowScene {
            return scene
        }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
    }
}

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
                    let rejection = offerCodeRejection(error)
                    call.reject(rejection.message, rejection.code)
                }
            }
            return
        }

        SKPaymentQueue.default().presentCodeRedemptionSheet()
        call.resolve(["presented": true])
    }

    private func offerCodeRejection(_ error: Error) -> (message: String, code: String) {
        let nsError = error as NSError
        let description = nsError.localizedDescription
        if isInvalidOrInactiveCode(domain: nsError.domain, code: nsError.code, description: description) {
            return (
                "That offer code isn't valid or isn't active yet. Double-check the code or try again later.",
                "INVALID_OFFER_CODE"
            )
        }
        if isUserCancellation(domain: nsError.domain, code: nsError.code, description: description) {
            return ("Offer code redemption was cancelled.", "1")
        }
        if description.range(of: "SKInternalErrorDomain", options: .caseInsensitive) != nil
            || description.range(of: "SKErrorDomain", options: .caseInsensitive) != nil {
            return ("Offer code redemption could not be completed. Try again.", "OFFER_UNAVAILABLE")
        }
        let text = description.trimmingCharacters(in: .whitespacesAndNewlines)
        return (text.isEmpty ? "Offer code redemption could not open." : text, String(nsError.code))
    }

    private func isInvalidOrInactiveCode(domain: String, code: Int, description: String) -> Bool {
        let text = description.lowercased()
        if domain == "SKInternalErrorDomain" && code == 12 { return true }
        if text.range(of: #"skinternalerrordomain[^\n]{0,48}\b12\b"#, options: .regularExpression) != nil {
            return true
        }
        // SKError.invalidOfferIdentifier 11, missingOfferParams 13, invalidOfferPrice 14, ineligibleForOffer 18.
        if domain == SKError.errorDomain && [11, 13, 14, 18].contains(code) { return true }
        if text.contains("invalid") && (text.contains("code") || text.contains("offer")) { return true }
        if text.contains("inactive") && (text.contains("code") || text.contains("offer")) { return true }
        if text.contains("not active") || text.contains("isn't active") || text.contains("is not valid") {
            return true
        }
        return false
    }

    private func isUserCancellation(domain: String, code: Int, description: String) -> Bool {
        // SKError.paymentCancelled 2, SKError.overlayCancelled 15.
        if domain == SKError.errorDomain && (code == 2 || code == 15) { return true }
        let text = description.lowercased()
        if text.contains("cancel") || text.contains("dismiss") { return true }
        return false
    }

    private func foregroundWindowScene() -> UIWindowScene? {
        if let scene = bridge?.viewController?.view.window?.windowScene {
            return scene
        }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
    }
}

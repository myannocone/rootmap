import Capacitor

class RootMapBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(EspnLoginPlugin())
        bridge?.registerPluginInstance(YahooLoginPlugin())
    }
}

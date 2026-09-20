namespace Paradize
{
    public static class SunnyBridgeContract
    {
        // Compatibility behind owner authentication, not executable attestation.
        // Default values from an older response cannot satisfy version and policy.
        public static bool Accepts(string service, int version, bool localOnlyRequired, string provider, bool paidEnabled)
        {
            return service == "paradize-sunny-local" && version == 2 &&
                localOnlyRequired && provider == "ollama" && !paidEnabled;
        }
    }
}

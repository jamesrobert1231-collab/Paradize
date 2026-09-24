namespace Paradize
{
    public static class SunnyBridgeContract
    {
        public static bool TryKnowledgeSummary(string status, string state, int records, int sources,
            string originalVerification, bool historicalAuthority, out string summary)
        {
            summary = "Imported knowledge could not be checked. This does not mean your records are empty.";
            if (status != "complete" || originalVerification != "on-access" || historicalAuthority ||
                records < 0 || records > 10000 || sources < 0 || sources > records) return false;
            if (state == "no-records" && records == 0 && sources == 0)
            {
                summary = "No records have been imported into this index. This does not mean your original stores are empty.";
                return true;
            }
            if (state != "index-ready" || records == 0 || sources == 0) return false;
            summary = records + " retained records from " + sources + " sources. Revisions count separately. " +
                "Originals are checked when opened; imported claims remain unverified. Search works without AI chat.";
            return true;
        }

        public static bool ChatReady(string status, string model)
        {
            return status == "ready" && (model == "qwen2.5:3b" || model == "qwen3.5:4b");
        }

        public static string HealthMessage(string status, string model)
        {
            if (ChatReady(status, model)) return "Sunny local AI • " + model;
            switch (status)
            {
                case "stopped": return "Sunny paused • explicitly resume to continue";
                case "local-only-unconfirmed": return "Sunny cannot chat until cloud access is disabled and confirmed • local controls ready";
                case "model-unavailable": return "Sunny needs a supported local model • local controls ready";
                case "ollama-unavailable": return "Sunny local AI service is unavailable • local controls ready";
                default: return "Sunny health was not recognized • relaunch with the current PARADIZE launcher";
            }
        }

        // Compatibility behind owner authentication, not executable attestation.
        // Default values from an older response cannot satisfy version and policy.
        public static bool Accepts(string service, int version, bool localOnlyRequired, string provider, bool paidEnabled)
        {
            return service == "paradize-sunny-local" && version == 2 &&
                localOnlyRequired && provider == "ollama" && !paidEnabled;
        }
    }
}

using System;
using System.Collections.ObjectModel;

namespace Paradize
{
    /// <summary>Character identity and location only; this catalog grants no worker capability.</summary>
    public sealed class IslandAgent
    {
        public readonly string Id;
        public readonly string Name;
        public readonly int DistrictIndex;

        internal IslandAgent(string id, string name, int districtIndex)
        { Id=id; Name=name; DistrictIndex=districtIndex; }

        // Sunny's availability comes from the existing session health display.
        public string ConnectionLabel { get { return Id=="sunny" ? null : "Not connected"; } }
        public string Availability { get { return Id=="sunny" ? "Your companion stays with you." : "This character cannot start work or take actions."; } }
    }

    /// <summary>Local browsing state, independent of conversation, navigation and authorization.</summary>
    public sealed class IslandAgentDirectory
    {
        static readonly ReadOnlyCollection<IslandAgent> entries=Array.AsReadOnly(new[] {
            new IslandAgent("sunny","SUNNY",0),
            new IslandAgent("archivist","ARCHIVIST",1),
            new IslandAgent("ledger","LEDGER",2),
            new IslandAgent("eve","EVE",3),
            new IslandAgent("atlas","ATLAS",4),
            new IslandAgent("director","DIRECTOR",5),
            new IslandAgent("sentinel","SENTINEL",6),
            new IslandAgent("godfry","GODFRY",6),
            new IslandAgent("stormy","STORMY",6),
            new IslandAgent("masked","MASKED",6)
        });

        public ReadOnlyCollection<IslandAgent> Agents { get { return entries; } }
        public IslandAgent Selected { get; private set; }
        public IslandAgentDirectory() { Selected=entries[0]; }

        public static IslandAgent Find(string id)
        {
            foreach(var agent in entries) if(string.Equals(agent.Id,id,StringComparison.Ordinal)) return agent;
            return null;
        }

        public bool Select(string id)
        {
            var agent=Find(id);
            if(agent==null) return false;
            Selected=agent;
            return true;
        }
    }
}

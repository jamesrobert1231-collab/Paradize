# Island agent directory

The Unity source adds an agent directory inside Sunny's existing panel. It lists
the ten established character identities and their districts. Selecting a name
shows that character's information; district buttons remain the navigation controls.
Navigation and selection preserve Sunny's current answer. District descriptions
have their own display, and the conversation input, global Sunny toggle and STOP
control retain their existing functions.

The immutable catalog in `IslandAgentDirectory.cs` contains identity and location
only. Every character other than Sunny displays **Not connected** and cannot start
work through the directory. Sunny uses the existing session availability display;
selecting another character never transfers Sunny's availability to that worker.
No detailed roles are invented for Godfry, Stormy or Masked, and this UI grants no
permissions or account connections.

## Source verification — September 27, 2026

The baseline test reproduced district navigation overwriting the current answer.
The new runner passes 95 checks on both .NET Framework and Unity Mono, including
the original ten spawn names/positions, stable district mappings, invalid selection,
disconnected defaults, answer preservation and existing stopped-navigation behavior.
It compiles production Start, Visit and SelectAgent methods with camera/island
doubles; it does not render the panel or execute Unity coroutines.

The publication copy also passes 51 bridge checks and 12 protected source-copy
checks on both runtimes, 25 health-contract checks, and full non-Editor C# compilation
against the installed Unity .NET Standard 2.1 references.

```powershell
./tests/unity/verify-agent-directory.ps1
./tests/unity/verify-bridge-contract.ps1
./tests/unity/verify-sunny-health-contract.ps1
./tests/unity/verify-source-copies.ps1
```

Actual player layout, keyboard/mouse focus, all ten selections, long-answer scrolling,
Sunny access while disconnected/paused, STOP/resume, asset loading and performance
still require live qualification. This source update does not replace the installed
player, activate workers or establish completion of the consolidation release.

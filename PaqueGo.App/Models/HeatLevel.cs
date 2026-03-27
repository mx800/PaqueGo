namespace PaqueGo.App.Models;

/// <summary>
/// Indicates how close the player is to the active egg.
/// </summary>
public enum HeatLevel
{
    /// <summary>
    /// Distance could not be computed.
    /// </summary>
    Unknown,

    /// <summary>
    /// The player is far from the egg.
    /// </summary>
    Cold,

    /// <summary>
    /// The player is getting closer.
    /// </summary>
    Warm,

    /// <summary>
    /// The player is very close to the egg.
    /// </summary>
    Hot
}
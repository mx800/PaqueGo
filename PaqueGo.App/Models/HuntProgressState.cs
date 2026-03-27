namespace PaqueGo.App.Models;

/// <summary>
/// Stores the persisted progression of a hunt on a device.
/// </summary>
public sealed class HuntProgressState
{
    /// <summary>
    /// Gets or sets the source key that produced the current hunt data.
    /// </summary>
    public string? SourceKey { get; init; }

    /// <summary>
    /// Gets or sets the identifiers of the eggs already found.
    /// </summary>
    public IReadOnlyList<string> FoundTargetIds { get; init; } = Array.Empty<string>();

    /// <summary>
    /// Gets or sets a value indicating whether the adventure was started by the user.
    /// </summary>
    public bool AdventureStarted { get; init; }
}
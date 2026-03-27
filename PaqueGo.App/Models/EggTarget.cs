namespace PaqueGo.App.Models;

/// <summary>
/// Represents a target egg that players must find.
/// </summary>
public sealed class EggTarget
{
    /// <summary>
    /// Gets or sets the stable identifier of the egg.
    /// </summary>
    public required string Id { get; init; }

    /// <summary>
    /// Gets or sets the friendly name displayed to players.
    /// </summary>
    public required string Name { get; init; }

    /// <summary>
    /// Gets or sets the latitude of the egg location.
    /// </summary>
    public double Latitude { get; init; }

    /// <summary>
    /// Gets or sets the longitude of the egg location.
    /// </summary>
    public double Longitude { get; init; }

    /// <summary>
    /// Gets or sets an optional hint for the organizer.
    /// </summary>
    public string? Hint { get; init; }
}
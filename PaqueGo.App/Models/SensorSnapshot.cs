namespace PaqueGo.App.Models;

/// <summary>
/// Represents the latest device sensor snapshot available to the app.
/// </summary>
public sealed class SensorSnapshot
{
    /// <summary>
    /// Gets or sets the current latitude.
    /// </summary>
    public double? Latitude { get; init; }

    /// <summary>
    /// Gets or sets the current longitude.
    /// </summary>
    public double? Longitude { get; init; }

    /// <summary>
    /// Gets or sets the GPS accuracy in meters.
    /// </summary>
    public double? AccuracyMeters { get; init; }

    /// <summary>
    /// Gets or sets the current heading in degrees.
    /// </summary>
    public double? HeadingDegrees { get; init; }

    /// <summary>
    /// Gets or sets a value indicating whether geolocation is available.
    /// </summary>
    public bool IsLocationAvailable { get; init; }

    /// <summary>
    /// Gets or sets a value indicating whether device orientation is available.
    /// </summary>
    public bool IsHeadingAvailable { get; init; }

    /// <summary>
    /// Gets or sets a value indicating whether iOS-style motion permission is required.
    /// </summary>
    public bool RequiresMotionPermission { get; init; }

    /// <summary>
    /// Gets or sets a value indicating whether motion permission has been granted.
    /// </summary>
    public bool MotionPermissionGranted { get; init; }

    /// <summary>
    /// Gets or sets the last geolocation error, if any.
    /// </summary>
    public string? GeolocationError { get; init; }

    /// <summary>
    /// Gets or sets the last orientation error, if any.
    /// </summary>
    public string? OrientationError { get; init; }
}
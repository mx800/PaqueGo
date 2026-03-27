namespace PaqueGo.App.Models;

/// <summary>
/// Describes how the app is currently displayed on the device.
/// </summary>
public sealed class DisplayState
{
    /// <summary>
    /// Gets or sets a value indicating whether the app is opened as an installed PWA.
    /// </summary>
    public bool IsStandalone { get; init; }

    /// <summary>
    /// Gets or sets a value indicating whether the browser can attempt fullscreen mode.
    /// </summary>
    public bool CanFullscreen { get; init; }

    /// <summary>
    /// Gets or sets a value indicating whether fullscreen mode is currently active.
    /// </summary>
    public bool IsFullscreen { get; init; }
}
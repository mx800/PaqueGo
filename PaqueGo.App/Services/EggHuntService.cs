using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.JSInterop;
using PaqueGo.App.Models;

namespace PaqueGo.App.Services;

/// <summary>
/// Coordinates target loading, sensor refresh and progression persistence for the Easter hunt.
/// </summary>
public sealed class EggHuntService(HttpClient httpClient, IJSRuntime jsRuntime) : IAsyncDisposable
{
    private const string CustomTargetsStorageKey = "paquego.custom-targets";
    private const string ProgressStorageKey = "paquego.progress";
    private const string SampleDataPath = "data/eggs.sample.json";

    private readonly JsonSerializerOptions serializerOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = true
    };

    private readonly HashSet<string> foundTargetIds = [];
    private IReadOnlyList<EggTarget> targets = Array.Empty<EggTarget>();
    private string currentSourceKey = "sample";
    private bool initialized;

    /// <summary>
    /// Raised whenever the hunt state changes.
    /// </summary>
    public event Action? StateChanged;

    /// <summary>
    /// Gets the currently available targets.
    /// </summary>
    public IReadOnlyList<EggTarget> Targets => targets;

    /// <summary>
    /// Gets a value indicating whether at least one target is configured.
    /// </summary>
    public bool HasTargets => targets.Count > 0;

    /// <summary>
    /// Gets the active target to chase.
    /// </summary>
    public EggTarget? ActiveTarget { get; private set; }

    /// <summary>
    /// Gets the latest sensor snapshot.
    /// </summary>
    public SensorSnapshot Snapshot { get; private set; } = new();

    /// <summary>
    /// Gets the display state of the app.
    /// </summary>
    public DisplayState DisplayState { get; private set; } = new();

    /// <summary>
    /// Gets the distance to the active target in meters.
    /// </summary>
    public double? DistanceToTargetMeters { get; private set; }

    /// <summary>
    /// Gets the global bearing to the active target.
    /// </summary>
    public double? BearingToTargetDegrees { get; private set; }

    /// <summary>
    /// Gets the relative bearing used by the compass arrow.
    /// </summary>
    public double? RelativeBearingDegrees { get; private set; }

    /// <summary>
    /// Gets a value indicating whether the adventure has already started.
    /// </summary>
    public bool AdventureStarted { get; private set; }

    /// <summary>
    /// Gets a value indicating whether the current source is the built-in sample.
    /// </summary>
    public bool IsUsingSampleData { get; private set; } = true;

    /// <summary>
    /// Gets the current data source label.
    /// </summary>
    public string DataSourceLabel { get; private set; } = "Aucune chasse configurée";

    /// <summary>
    /// Gets the number of found eggs.
    /// </summary>
    public int FoundCount => foundTargetIds.Count;

    /// <summary>
    /// Gets the total number of eggs.
    /// </summary>
    public int TotalCount => targets.Count;

    /// <summary>
    /// Gets a value indicating whether the hunt is complete.
    /// </summary>
    public bool IsCompleted => targets.Count > 0 && foundTargetIds.Count >= targets.Count;

    /// <summary>
    /// Gets the current heat level.
    /// </summary>
    public HeatLevel HeatLevel => HuntMath.ToHeatLevel(DistanceToTargetMeters);

    /// <summary>
    /// Gets a player-friendly label for the current heat level.
    /// </summary>
    public string HeatLevelLabel => HeatLevel switch
    {
        HeatLevel.Hot => "Chaud",
        HeatLevel.Warm => "Tiède",
        HeatLevel.Cold => "Froid",
        _ => "En attente"
    };

    /// <summary>
    /// Gets a child-friendly status message based on current hunt conditions.
    /// </summary>
    public string PlayerMessage => BuildPlayerMessage();

    /// <summary>
    /// Initializes the service with persisted data and the sample hunt when necessary.
    /// </summary>
    /// <returns>A task that represents the asynchronous operation.</returns>
    public async Task InitializeAsync()
    {
        if (initialized)
        {
            return;
        }

        var storedJson = await GetStorageStringAsync(CustomTargetsStorageKey);

        if (!string.IsNullOrWhiteSpace(storedJson))
        {
            try
            {
                ApplyTargets(storedJson, "Configuration organisateur", false);
                IsUsingSampleData = false;
            }
            catch (Exception) when (storedJson is not null)
            {
                await RemoveStorageKeyAsync(CustomTargetsStorageKey);
                ClearTargets();
            }
        }
        else
        {
            ClearTargets();
        }

        await RestoreProgressAsync();
        await RefreshAsync();
        initialized = true;
        NotifyStateChanged();
    }

    /// <summary>
    /// Starts the hunt and requests the device sensors.
    /// </summary>
    /// <returns>A task that represents the asynchronous operation.</returns>
    public async Task StartAdventureAsync()
    {
        AdventureStarted = true;

        try
        {
            await jsRuntime.InvokeAsync<bool>("paqueGo.requestMotionPermission");
            await jsRuntime.InvokeVoidAsync("paqueGo.startSensors");
        }
        catch (JSException)
        {
        }

        await TryEnterFullscreenAsync();
        await PersistProgressAsync();
        await RefreshAsync();
    }

    /// <summary>
    /// Restarts the browser sensor listeners after a page navigation or reload.
    /// </summary>
    /// <returns>A task that represents the asynchronous operation.</returns>
    public async Task ResumeSensorsAsync()
    {
        try
        {
            await jsRuntime.InvokeVoidAsync("paqueGo.startSensors");
        }
        catch (JSException)
        {
        }

        await RefreshAsync();
    }

    /// <summary>
    /// Refreshes the current sensor snapshot and recomputes the active target.
    /// </summary>
    /// <returns>A task that represents the asynchronous operation.</returns>
    public async Task RefreshAsync()
    {
        try
        {
            Snapshot = await jsRuntime.InvokeAsync<SensorSnapshot>("paqueGo.getSensorSnapshot");
            DisplayState = await jsRuntime.InvokeAsync<DisplayState>("paqueGo.getDisplayState");
        }
        catch (JSException)
        {
            Snapshot = new SensorSnapshot();
            DisplayState = new DisplayState();
        }

        RecomputeDerivedState();
        await PushBearingToJsAsync();
        NotifyStateChanged();
    }

    /// <summary>
    /// Attempts to switch the browser into fullscreen mode.
    /// </summary>
    /// <returns>A task that represents the asynchronous operation.</returns>
    public async Task TryEnterFullscreenAsync()
    {
        try
        {
            await jsRuntime.InvokeVoidAsync("paqueGo.tryEnterFullscreen");
            DisplayState = await jsRuntime.InvokeAsync<DisplayState>("paqueGo.getDisplayState");
        }
        catch (JSException)
        {
        }

        NotifyStateChanged();
    }

    /// <summary>
    /// Loads a new set of targets from a JSON payload.
    /// </summary>
    /// <param name="json">The raw JSON content.</param>
    /// <param name="sourceLabel">The friendly source label.</param>
    /// <returns>A task that represents the asynchronous operation.</returns>
    public async Task LoadTargetsFromJsonAsync(string json, string sourceLabel)
    {
        ApplyTargets(json, sourceLabel, false);
        await SetStorageStringAsync(CustomTargetsStorageKey, json);
        await PersistProgressAsync();
        NotifyStateChanged();
    }

    /// <summary>
    /// Loads a manually configured set of hunt targets.
    /// </summary>
    /// <param name="configuredTargets">The configured targets to persist.</param>
    /// <param name="sourceLabel">The friendly source label.</param>
    /// <returns>A task that represents the asynchronous operation.</returns>
    public async Task LoadConfiguredTargetsAsync(IReadOnlyList<EggTarget> configuredTargets, string sourceLabel)
    {
        if (configuredTargets.Count == 0)
        {
            throw new InvalidOperationException("Ajoute au moins un point avant de commencer la chasse.");
        }

        var json = JsonSerializer.Serialize(configuredTargets, serializerOptions);
        ApplyTargets(json, sourceLabel, false);
        await SetStorageStringAsync(CustomTargetsStorageKey, json);
        await PersistProgressAsync();
        NotifyStateChanged();
    }

    /// <summary>
    /// Clears the configured hunt targets and removes their persisted storage.
    /// </summary>
    /// <returns>A task that represents the asynchronous operation.</returns>
    public async Task ClearConfiguredTargetsAsync()
    {
        ClearTargets();
        await RemoveStorageKeyAsync(CustomTargetsStorageKey);
        await PersistProgressAsync();
        NotifyStateChanged();
    }

    /// <summary>
    /// Restores the built-in sample hunt.
    /// </summary>
    /// <returns>A task that represents the asynchronous operation.</returns>
    public async Task LoadSampleTargetsAsync()
    {
        var sampleJson = await httpClient.GetStringAsync(SampleDataPath);
        ApplyTargets(sampleJson, "Exemple intégré", true);
        await RemoveStorageKeyAsync(CustomTargetsStorageKey);
        await PersistProgressAsync();
        NotifyStateChanged();
    }

    /// <summary>
    /// Marks the active egg as found and selects the next nearest target.
    /// </summary>
    /// <returns>A task that represents the asynchronous operation.</returns>
    public async Task MarkCurrentTargetFoundAsync()
    {
        if (ActiveTarget is null)
        {
            return;
        }

        await MarkTargetFoundAsync(ActiveTarget.Id);
    }

    /// <summary>
    /// Marks a specific egg as found and selects the next nearest target.
    /// </summary>
    /// <param name="targetId">The identifier of the egg to mark as found.</param>
    /// <returns>A task that represents the asynchronous operation.</returns>
    public async Task MarkTargetFoundAsync(string targetId)
    {
        if (string.IsNullOrWhiteSpace(targetId) || foundTargetIds.Contains(targetId) || targets.All(target => target.Id != targetId))
        {
            return;
        }

        foundTargetIds.Add(targetId);
        RecomputeDerivedState();
        await PersistProgressAsync();
        NotifyStateChanged();
    }

    /// <summary>
    /// Resets the local progression while keeping the current source data.
    /// </summary>
    /// <returns>A task that represents the asynchronous operation.</returns>
    public async Task ResetProgressAsync()
    {
        foundTargetIds.Clear();
        AdventureStarted = false;
        RecomputeDerivedState();
        await PersistProgressAsync();
        NotifyStateChanged();
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        try
        {
            await jsRuntime.InvokeVoidAsync("paqueGo.stopSensors");
        }
        catch (JSException)
        {
        }
    }

    private async Task PushBearingToJsAsync()
    {
        try
        {
            await jsRuntime.InvokeVoidAsync("paqueGo.setTargetBearing", BearingToTargetDegrees);
        }
        catch (JSException)
        {
        }
    }

    private static IReadOnlyList<EggTarget> ParseTargets(string json)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        var source = root;

        if (root.ValueKind == JsonValueKind.Object)
        {
            if (root.TryGetProperty("eggs", out var eggs))
            {
                source = eggs;
            }
            else if (root.TryGetProperty("points", out var points))
            {
                source = points;
            }
        }

        if (source.ValueKind != JsonValueKind.Array)
        {
            throw new InvalidOperationException("Le JSON doit contenir une liste d'objets ou une propriété eggs/points.");
        }

        var result = new List<EggTarget>();
        var index = 0;

        foreach (var element in source.EnumerateArray())
        {
            index++;

            var name = ReadString(element, "name", "title", "label") ?? $"Oeuf {index}";
            var latitude = ReadDouble(element, "latitude", "lat");
            var longitude = ReadDouble(element, "longitude", "lng", "lon", "long");
            var id = ReadString(element, "id") ?? BuildSlug(name, index);
            var hint = ReadString(element, "hint", "indice");

            result.Add(new EggTarget
            {
                Id = id,
                Name = name,
                Latitude = latitude,
                Longitude = longitude,
                Hint = hint
            });
        }

        if (result.Count == 0)
        {
            throw new InvalidOperationException("Le fichier JSON ne contient aucun point exploitable.");
        }

        return result;
    }

    private static string? ReadString(JsonElement element, params string[] propertyNames)
    {
        foreach (var propertyName in propertyNames)
        {
            if (!TryGetPropertyIgnoreCase(element, propertyName, out var property))
            {
                continue;
            }

            if (property.ValueKind == JsonValueKind.String)
            {
                return property.GetString();
            }
        }

        return null;
    }

    private static double ReadDouble(JsonElement element, params string[] propertyNames)
    {
        foreach (var propertyName in propertyNames)
        {
            if (!TryGetPropertyIgnoreCase(element, propertyName, out var property))
            {
                continue;
            }

            if (property.ValueKind == JsonValueKind.Number && property.TryGetDouble(out var numericValue))
            {
                return numericValue;
            }

            if (property.ValueKind == JsonValueKind.String && double.TryParse(property.GetString(), out var stringValue))
            {
                return stringValue;
            }
        }

        throw new InvalidOperationException($"La propriété {propertyNames[0]} est manquante ou invalide.");
    }

    private static bool TryGetPropertyIgnoreCase(JsonElement element, string propertyName, out JsonElement propertyValue)
    {
        foreach (var property in element.EnumerateObject())
        {
            if (string.Equals(property.Name, propertyName, StringComparison.OrdinalIgnoreCase))
            {
                propertyValue = property.Value;
                return true;
            }
        }

        propertyValue = default;
        return false;
    }

    private static string BuildSlug(string name, int index)
    {
        var builder = new StringBuilder();

        foreach (var character in name.ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(character))
            {
                builder.Append(character);
                continue;
            }

            if (builder.Length > 0 && builder[^1] != '-')
            {
                builder.Append('-');
            }
        }

        var slug = builder.ToString().Trim('-');
        return string.IsNullOrWhiteSpace(slug) ? $"oeuf-{index}" : slug;
    }

    private async Task RestoreProgressAsync()
    {
        var progressJson = await GetStorageStringAsync(ProgressStorageKey);

        if (string.IsNullOrWhiteSpace(progressJson))
        {
            return;
        }

        HuntProgressState? progress;

        try
        {
            progress = JsonSerializer.Deserialize<HuntProgressState>(progressJson, serializerOptions);
        }
        catch (JsonException)
        {
            await RemoveStorageKeyAsync(ProgressStorageKey);
            return;
        }

        if (progress?.SourceKey != currentSourceKey)
        {
            return;
        }

        foundTargetIds.Clear();

        foreach (var targetId in progress.FoundTargetIds)
        {
            foundTargetIds.Add(targetId);
        }

        AdventureStarted = progress.AdventureStarted;
        RecomputeDerivedState();
    }

    private void ApplyTargets(string json, string sourceLabel, bool isSample)
    {
        targets = ParseTargets(json);
        DataSourceLabel = sourceLabel;
        IsUsingSampleData = isSample;
        currentSourceKey = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json)));
        foundTargetIds.Clear();
        AdventureStarted = false;
        RecomputeDerivedState();
    }

    private void RecomputeDerivedState()
    {
        var remainingTargets = targets.Where(target => !foundTargetIds.Contains(target.Id)).ToArray();

        if (remainingTargets.Length == 0)
        {
            ActiveTarget = null;
            DistanceToTargetMeters = null;
            BearingToTargetDegrees = null;
            RelativeBearingDegrees = null;
            return;
        }

        ActiveTarget = Snapshot.IsLocationAvailable && Snapshot.Latitude is double latitude && Snapshot.Longitude is double longitude
            ? HuntMath.SelectNearestTarget(latitude, longitude, remainingTargets)
            : remainingTargets[0];

        if (ActiveTarget is null || !Snapshot.IsLocationAvailable || Snapshot.Latitude is not double currentLatitude || Snapshot.Longitude is not double currentLongitude)
        {
            DistanceToTargetMeters = null;
            BearingToTargetDegrees = null;
            RelativeBearingDegrees = null;
            return;
        }

        DistanceToTargetMeters = HuntMath.CalculateDistanceMeters(currentLatitude, currentLongitude, ActiveTarget.Latitude, ActiveTarget.Longitude);
        BearingToTargetDegrees = HuntMath.CalculateBearingDegrees(currentLatitude, currentLongitude, ActiveTarget.Latitude, ActiveTarget.Longitude);
        RelativeBearingDegrees = Snapshot.IsHeadingAvailable && Snapshot.HeadingDegrees is double headingDegrees
            ? HuntMath.CalculateRelativeBearingDegrees(BearingToTargetDegrees.Value, headingDegrees)
            : BearingToTargetDegrees;
    }

    private string BuildPlayerMessage()
    {
        if (targets.Count == 0)
        {
            return "Configure d'abord la chasse sur la page principale avant de lancer l'aventure.";
        }

        if (IsCompleted)
        {
            return "Tous les oeufs sont trouvés. Le panier est complet !";
        }

        if (!AdventureStarted)
        {
            return "Appuie sur Commencer la chasse pour lancer le GPS et la boussole.";
        }

        if (!Snapshot.IsLocationAvailable)
        {
            return !string.IsNullOrWhiteSpace(Snapshot.GeolocationError)
                ? Snapshot.GeolocationError!
                : "Active la localisation pour que la boussole sache où tu es.";
        }

        return HeatLevel switch
        {
            HeatLevel.Hot => "Chaud ! L'oeuf est juste à côté de toi.",
            HeatLevel.Warm => "Tiède ! Continue dans cette direction.",
            HeatLevel.Cold => "Froid, avance encore vers la flèche.",
            _ => "La boussole cherche encore le meilleur chemin."
        };
    }

    private async Task PersistProgressAsync()
    {
        var progress = new HuntProgressState
        {
            SourceKey = currentSourceKey,
            FoundTargetIds = foundTargetIds.OrderBy(targetId => targetId, StringComparer.Ordinal).ToArray(),
            AdventureStarted = AdventureStarted
        };

        await SetStorageStringAsync(ProgressStorageKey, JsonSerializer.Serialize(progress, serializerOptions));
    }

    private void ClearTargets()
    {
        targets = Array.Empty<EggTarget>();
        DataSourceLabel = "Aucune chasse configurée";
        IsUsingSampleData = false;
        currentSourceKey = "empty";
        foundTargetIds.Clear();
        AdventureStarted = false;
        RecomputeDerivedState();
    }

    private async Task<string?> GetStorageStringAsync(string key)
    {
        try
        {
            return await jsRuntime.InvokeAsync<string?>("paqueGo.localStorageGet", key);
        }
        catch (JSException)
        {
            return null;
        }
    }

    private async Task SetStorageStringAsync(string key, string value)
    {
        try
        {
            await jsRuntime.InvokeVoidAsync("paqueGo.localStorageSet", key, value);
        }
        catch (JSException)
        {
        }
    }

    private async Task RemoveStorageKeyAsync(string key)
    {
        try
        {
            await jsRuntime.InvokeVoidAsync("paqueGo.localStorageRemove", key);
        }
        catch (JSException)
        {
        }
    }

    private void NotifyStateChanged()
    {
        StateChanged?.Invoke();
    }
}
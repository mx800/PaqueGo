using PaqueGo.App.Models;

namespace PaqueGo.App.Services;

/// <summary>
/// Provides geographic calculations used by the egg hunt.
/// </summary>
public static class HuntMath
{
    private const double EarthRadiusMeters = 6_371_000d;

    /// <summary>
    /// Calculates the surface distance between two coordinates in meters.
    /// </summary>
    /// <param name="latitude1">The first latitude.</param>
    /// <param name="longitude1">The first longitude.</param>
    /// <param name="latitude2">The second latitude.</param>
    /// <param name="longitude2">The second longitude.</param>
    /// <returns>The distance in meters.</returns>
    public static double CalculateDistanceMeters(double latitude1, double longitude1, double latitude2, double longitude2)
    {
        var latitudeDelta = DegreesToRadians(latitude2 - latitude1);
        var longitudeDelta = DegreesToRadians(longitude2 - longitude1);

        var firstLatitudeRadians = DegreesToRadians(latitude1);
        var secondLatitudeRadians = DegreesToRadians(latitude2);

        var a = Math.Pow(Math.Sin(latitudeDelta / 2d), 2d) +
                Math.Cos(firstLatitudeRadians) * Math.Cos(secondLatitudeRadians) *
                Math.Pow(Math.Sin(longitudeDelta / 2d), 2d);

        var c = 2d * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1d - a));
        return EarthRadiusMeters * c;
    }

    /// <summary>
    /// Calculates the initial bearing from the first coordinate to the second.
    /// </summary>
    /// <param name="latitude1">The first latitude.</param>
    /// <param name="longitude1">The first longitude.</param>
    /// <param name="latitude2">The second latitude.</param>
    /// <param name="longitude2">The second longitude.</param>
    /// <returns>The bearing in degrees from north.</returns>
    public static double CalculateBearingDegrees(double latitude1, double longitude1, double latitude2, double longitude2)
    {
        var firstLatitudeRadians = DegreesToRadians(latitude1);
        var secondLatitudeRadians = DegreesToRadians(latitude2);
        var deltaLongitudeRadians = DegreesToRadians(longitude2 - longitude1);

        var y = Math.Sin(deltaLongitudeRadians) * Math.Cos(secondLatitudeRadians);
        var x = Math.Cos(firstLatitudeRadians) * Math.Sin(secondLatitudeRadians) -
                Math.Sin(firstLatitudeRadians) * Math.Cos(secondLatitudeRadians) * Math.Cos(deltaLongitudeRadians);

        return NormalizeDegrees(RadiansToDegrees(Math.Atan2(y, x)));
    }

    /// <summary>
    /// Calculates the relative rotation to point from the current heading to the target bearing.
    /// </summary>
    /// <param name="bearingDegrees">The target bearing.</param>
    /// <param name="headingDegrees">The current device heading.</param>
    /// <returns>The relative angle in degrees between -180 and 180.</returns>
    public static double CalculateRelativeBearingDegrees(double bearingDegrees, double headingDegrees)
    {
        var delta = NormalizeDegrees(bearingDegrees - headingDegrees);
        return delta > 180d ? delta - 360d : delta;
    }

    /// <summary>
    /// Selects the nearest target from a collection.
    /// </summary>
    /// <param name="latitude">The player latitude.</param>
    /// <param name="longitude">The player longitude.</param>
    /// <param name="targets">The remaining targets.</param>
    /// <returns>The closest target or <see langword="null"/> when there are no targets.</returns>
    public static EggTarget? SelectNearestTarget(double latitude, double longitude, IEnumerable<EggTarget> targets)
    {
        EggTarget? closestTarget = null;
        double closestDistance = double.MaxValue;

        foreach (var target in targets)
        {
            var distance = CalculateDistanceMeters(latitude, longitude, target.Latitude, target.Longitude);

            if (distance >= closestDistance)
            {
                continue;
            }

            closestTarget = target;
            closestDistance = distance;
        }

        return closestTarget;
    }

    /// <summary>
    /// Converts a distance to a child-friendly label.
    /// </summary>
    /// <param name="distanceMeters">The optional distance in meters.</param>
    /// <returns>A readable label.</returns>
    public static string ToFriendlyDistance(double? distanceMeters)
    {
        if (distanceMeters is null)
        {
            return "Distance en attente";
        }

        if (distanceMeters < 1d)
        {
            return "Moins d'1 m";
        }

        return $"{Math.Round(distanceMeters.Value):0} m";
    }

    /// <summary>
    /// Converts a distance to a heat level.
    /// </summary>
    /// <param name="distanceMeters">The optional distance in meters.</param>
    /// <returns>The matching heat level.</returns>
    public static HeatLevel ToHeatLevel(double? distanceMeters)
    {
        if (distanceMeters is null)
        {
            return HeatLevel.Unknown;
        }

        if (distanceMeters <= 5d)
        {
            return HeatLevel.Hot;
        }

        if (distanceMeters <= 10d)
        {
            return HeatLevel.Warm;
        }

        return HeatLevel.Cold;
    }

    /// <summary>
    /// Normalizes an angle to the 0..360 range.
    /// </summary>
    /// <param name="degrees">The angle to normalize.</param>
    /// <returns>A normalized angle.</returns>
    public static double NormalizeDegrees(double degrees)
    {
        var normalized = degrees % 360d;
        return normalized < 0d ? normalized + 360d : normalized;
    }

    private static double DegreesToRadians(double degrees)
    {
        return degrees * Math.PI / 180d;
    }

    private static double RadiansToDegrees(double radians)
    {
        return radians * 180d / Math.PI;
    }
}
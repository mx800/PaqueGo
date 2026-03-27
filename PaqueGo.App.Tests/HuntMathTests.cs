using PaqueGo.App.Models;
using PaqueGo.App.Services;

namespace PaqueGo.App.Tests;

public sealed class HuntMathTests
{
    [Fact]
    public void CalculateDistanceMeters_SamePoint_ReturnsZero()
    {
        var distance = HuntMath.CalculateDistanceMeters(48.8566, 2.3522, 48.8566, 2.3522);

        Assert.Equal(0d, distance, 6);
    }

    [Fact]
    public void SelectNearestTarget_WithMultipleTargets_ReturnsClosestOne()
    {
        var targets = new[]
        {
            new EggTarget { Id = "far", Name = "Far", Latitude = 48.8576, Longitude = 2.3532 },
            new EggTarget { Id = "near", Name = "Near", Latitude = 48.85661, Longitude = 2.35221 },
            new EggTarget { Id = "mid", Name = "Mid", Latitude = 48.8569, Longitude = 2.3526 }
        };

        var nearest = HuntMath.SelectNearestTarget(48.8566, 2.3522, targets);

        Assert.NotNull(nearest);
        Assert.Equal("near", nearest!.Id);
    }

    [Theory]
    [InlineData(11, HeatLevel.Cold)]
    [InlineData(10, HeatLevel.Warm)]
    [InlineData(6, HeatLevel.Warm)]
    [InlineData(5, HeatLevel.Hot)]
    [InlineData(1, HeatLevel.Hot)]
    public void ToHeatLevel_WithThresholds_ReturnsExpectedLevel(double distance, HeatLevel expected)
    {
        var heatLevel = HuntMath.ToHeatLevel(distance);

        Assert.Equal(expected, heatLevel);
    }

    [Fact]
    public void CalculateRelativeBearingDegrees_WrapsAnglesIntoSignedRange()
    {
        var relativeBearing = HuntMath.CalculateRelativeBearingDegrees(10, 350);

        Assert.Equal(20, relativeBearing, 6);
    }
}
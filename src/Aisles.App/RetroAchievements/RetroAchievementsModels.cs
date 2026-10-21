namespace Aisles.App.RetroAchievements;

/// <summary>The account fields Aisles can safely display in Settings.</summary>
public sealed record RetroAchievementsAccount(string User, string? Ulid, int TotalPoints, int TotalSoftcorePoints);

/// <summary>One game from RetroAchievements' per-system game list.</summary>
public sealed record RetroAchievementsGame(int Id, string Title, int NumAchievements, int Points);

/// <summary>A game-ID match plus the local name that produced it, for diagnostics.</summary>
public sealed record RetroAchievementsMatch(RetroAchievementsGame Game, string Source);

/// <summary>Earned/total achievement progress for one game and one account.</summary>
public sealed record RetroAchievementsProgress(int GameId, int Earned, int Total, int Points);

/// <summary>
/// A user-facing RetroAchievements failure. <see cref="IsAuthFailure"/> distinguishes
/// bad credentials from transient network trouble so the rail can stop claiming the
/// account is linked when the API rejects it.
/// </summary>
public sealed class RetroAchievementsException : Exception
{
    public RetroAchievementsException(string message, bool isAuthFailure = false, Exception? inner = null)
        : base(message, inner)
    {
        IsAuthFailure = isAuthFailure;
    }

    public bool IsAuthFailure { get; }
}

namespace AdDeliverableManager.Security;

public sealed record UserRecord(
    int Id,
    string Username,
    string DisplayName,
    string PasswordHash,
    string PasswordSalt,
    bool IsEnabled,
    bool MustChangePassword,
    string? LastLoginAt,
    int Revision);

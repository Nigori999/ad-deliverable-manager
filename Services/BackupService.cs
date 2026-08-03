using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Services;

public sealed class BackupService
{
    private readonly DatabaseService _database;
    private readonly IConfiguration _configuration;
    private readonly SemaphoreSlim _lock = new(1, 1);

    public BackupService(DatabaseService database, IConfiguration configuration)
    {
        _database = database;
        _configuration = configuration;
    }

    public async Task<string?> CreateBackupAsync(string reason, CancellationToken cancellationToken = default)
    {
        if (!File.Exists(_database.DatabasePath)) return null;

        await _lock.WaitAsync(cancellationToken);
        try
        {
            var directory = _database.ResolveBackupDirectory();
            Directory.CreateDirectory(directory);
            var safeReason = string.Concat(reason.Where(char.IsLetterOrDigit));
            var fileName = $"deliverables_{DateTime.Now:yyyyMMdd_HHmmss}_{safeReason}.db";
            var destinationPath = Path.Combine(directory, fileName);

            await using var source = await _database.OpenConnectionAsync(cancellationToken);
            await using var destination = new SqliteConnection($"Data Source={destinationPath}");
            await destination.OpenAsync(cancellationToken);
            source.BackupDatabase(destination);
            return destinationPath;
        }
        finally
        {
            _lock.Release();
        }
    }

    public void DeleteExpiredBackups()
    {
        var days = Math.Max(1, _configuration.GetValue("Backup:KeepDays", 30));
        var threshold = DateTime.Now.AddDays(-days);
        var directory = _database.ResolveBackupDirectory();
        if (!Directory.Exists(directory)) return;

        foreach (var file in Directory.EnumerateFiles(directory, "*.db"))
        {
            try
            {
                if (File.GetLastWriteTime(file) < threshold) File.Delete(file);
            }
            catch
            {
                // 单个备份删除失败不影响应用运行。
            }
        }
    }
}

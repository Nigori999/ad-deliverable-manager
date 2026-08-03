using System.Reflection;
using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Services;

public sealed class DatabaseService
{
    private readonly IConfiguration _configuration;
    private readonly string _databasePath;

    public DatabaseService(IConfiguration configuration)
    {
        _configuration = configuration;
        var configuredPath = configuration["Database:Path"] ?? "data/deliverables.db";
        _databasePath = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, configuredPath));
    }

    public string DatabasePath => _databasePath;

    public async Task<SqliteConnection> OpenConnectionAsync(CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_databasePath)!);
        var connection = new SqliteConnection($"Data Source={_databasePath};Cache=Shared;Pooling=True");
        await connection.OpenAsync(cancellationToken);

        await using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;";
        await command.ExecuteNonQueryAsync(cancellationToken);
        return connection;
    }

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_databasePath)!);
        await using var connection = await OpenConnectionAsync(cancellationToken);

        var assembly = Assembly.GetExecutingAssembly();
        var resourceName = assembly.GetManifestResourceNames()
            .Single(name => name.EndsWith("Data.schema.sql", StringComparison.OrdinalIgnoreCase));

        await using var stream = assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException("无法读取内置数据库脚本。" );
        using var reader = new StreamReader(stream);
        var sql = await reader.ReadToEndAsync(cancellationToken);

        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public string ResolveBackupDirectory()
    {
        var configured = _configuration["Backup:Directory"] ?? "backups";
        return Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, configured));
    }
}

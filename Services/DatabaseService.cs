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
        var schemaResource = assembly.GetManifestResourceNames()
            .Single(name => name.EndsWith("Data.schema.sql", StringComparison.OrdinalIgnoreCase));
        await ExecuteResourceAsync(connection, assembly, schemaResource, cancellationToken);

        var migrationResources = assembly.GetManifestResourceNames()
            .Where(name => name.Contains(".Data.migrations.", StringComparison.OrdinalIgnoreCase) && name.EndsWith(".sql", StringComparison.OrdinalIgnoreCase))
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase);
        foreach (var resourceName in migrationResources)
            await ExecuteResourceAsync(connection, assembly, resourceName, cancellationToken);
    }

    private static async Task ExecuteResourceAsync(SqliteConnection connection, Assembly assembly, string resourceName, CancellationToken cancellationToken)
    {
        await using var stream = assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException($"无法读取内置数据库脚本：{resourceName}" );
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

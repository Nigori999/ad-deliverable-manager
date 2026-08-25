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

        await using (var createHistory = connection.CreateCommand())
        {
            createHistory.CommandText = """
                CREATE TABLE IF NOT EXISTS SchemaMigrations(
                    MigrationId TEXT PRIMARY KEY,
                    AppliedAt TEXT NOT NULL
                );
                """;
            await createHistory.ExecuteNonQueryAsync(cancellationToken);
        }

        var migrationResources = assembly.GetManifestResourceNames()
            .Where(name => name.Contains(".Data.migrations.", StringComparison.OrdinalIgnoreCase) && name.EndsWith(".sql", StringComparison.OrdinalIgnoreCase))
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        foreach (var resourceName in migrationResources)
        {
            var marker = ".Data.migrations.";
            var markerIndex = resourceName.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
            var migrationId = markerIndex >= 0 ? resourceName[(markerIndex + marker.Length)..] : resourceName;

            await using var exists = connection.CreateCommand();
            exists.CommandText = "SELECT COUNT(*) FROM SchemaMigrations WHERE MigrationId=$id";
            exists.Parameters.AddWithValue("$id", migrationId);
            if (Convert.ToInt32(await exists.ExecuteScalarAsync(cancellationToken)) > 0) continue;

            var sql = await ReadResourceAsync(assembly, resourceName, cancellationToken);
            using var transaction = connection.BeginTransaction();
            await using (var migration = connection.CreateCommand())
            {
                migration.Transaction = transaction;
                migration.CommandText = sql;
                await migration.ExecuteNonQueryAsync(cancellationToken);
            }
            await using (var record = connection.CreateCommand())
            {
                record.Transaction = transaction;
                record.CommandText = "INSERT INTO SchemaMigrations(MigrationId,AppliedAt) VALUES($id,$now)";
                record.Parameters.AddWithValue("$id", migrationId);
                record.Parameters.AddWithValue("$now", DateTime.UtcNow.ToString("O"));
                await record.ExecuteNonQueryAsync(cancellationToken);
            }
            await transaction.CommitAsync(cancellationToken);
        }
    }

    private static async Task ExecuteResourceAsync(SqliteConnection connection, Assembly assembly, string resourceName, CancellationToken cancellationToken)
    {
        var sql = await ReadResourceAsync(assembly, resourceName, cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task<string> ReadResourceAsync(Assembly assembly, string resourceName, CancellationToken cancellationToken)
    {
        await using var stream = assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException($"无法读取内置数据库脚本：{resourceName}");
        using var reader = new StreamReader(stream);
        return await reader.ReadToEndAsync(cancellationToken);
    }

    public string ResolveBackupDirectory()
    {
        var configured = _configuration["Backup:Directory"] ?? "backups";
        return Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, configured));
    }
}

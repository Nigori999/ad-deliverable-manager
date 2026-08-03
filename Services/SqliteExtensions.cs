using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Services;

public static class SqliteExtensions
{
    public static SqliteParameter AddValue(this SqliteParameterCollection parameters, string name, object? value)
    {
        return parameters.AddWithValue(name, value ?? DBNull.Value);
    }

    public static string? GetNullableString(this SqliteDataReader reader, int ordinal)
    {
        return reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);
    }

    public static long? GetNullableInt64(this SqliteDataReader reader, int ordinal)
    {
        return reader.IsDBNull(ordinal) ? null : reader.GetInt64(ordinal);
    }
}

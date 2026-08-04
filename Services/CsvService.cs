using System.Text;

namespace AdDeliverableManager.Services;

public static class CsvService
{
    public static byte[] Build(string[] fields, IReadOnlyDictionary<string, string> headers,
        IEnumerable<IReadOnlyDictionary<string, object?>> rows)
    {
        var builder = new StringBuilder();
        builder.AppendLine(string.Join(',', fields.Select(field => Escape(headers[field]))));
        foreach (var row in rows)
            builder.AppendLine(string.Join(',', fields.Select(field => Escape(row.TryGetValue(field, out var value) ? value : null))));
        return Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(builder.ToString())).ToArray();
    }

    private static string Escape(object? value)
    {
        var text = Convert.ToString(value) ?? "";
        if (text.Length > 0 && text[0] is '=' or '+' or '-' or '@') text = "'" + text;
        return '"' + text.Replace("\"", "\"\"") + '"';
    }
}

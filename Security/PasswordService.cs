using System.Security.Cryptography;

namespace AdDeliverableManager.Security;

public sealed class PasswordService
{
    private const int Iterations = 150_000;
    private const int SaltSize = 16;
    private const int HashSize = 32;

    public (string Hash, string Salt) HashPassword(string password)
    {
        ValidatePassword(password);
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, HashSize);
        return (Convert.ToBase64String(hash), Convert.ToBase64String(salt));
    }

    public bool Verify(string password, string hashBase64, string saltBase64)
    {
        try
        {
            var salt = Convert.FromBase64String(saltBase64);
            var expected = Convert.FromBase64String(hashBase64);
            var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, expected.Length);
            return CryptographicOperations.FixedTimeEquals(expected, actual);
        }
        catch (FormatException)
        {
            return false;
        }
    }

    public static void ValidatePassword(string password)
    {
        if (string.IsNullOrWhiteSpace(password) || password.Length < 8)
            throw new ArgumentException("密码至少需要8位。");
        if (!password.Any(char.IsLetter) || !password.Any(char.IsDigit))
            throw new ArgumentException("密码必须同时包含字母和数字。");
    }
}

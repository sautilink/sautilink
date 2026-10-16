import java.io.*;
import java.nio.file.*;
import java.security.*;
import java.security.cert.X509Certificate;
import java.util.*;
import java.util.jar.*;

// Reads every payload entry to trigger JAR cryptographic verification; never reads a private key.
class VerifyPlayBundle {
  public static void main(String[] args) {
    try {
      if (args.length != 1) throw new IllegalArgumentException();
      String expected = "31c773a7229a563d92f7047a56735ad7b02027d27a6e020d8923dd5418f4b50f";
      long total = 0; int signed = 0;
      Set<String> names = new HashSet<>();
      try (JarFile jar = new JarFile(args[0], true)) {
        Enumeration<JarEntry> entries = jar.entries();
        byte[] buffer = new byte[65536];
        while (entries.hasMoreElements()) {
          JarEntry entry = entries.nextElement();
          String name = entry.getName();
          if (!names.add(name) || name.startsWith("/") || Arrays.asList(name.split("/")).contains("..")) throw new SecurityException();
          if (entry.isDirectory()) continue;
          long bytes = 0;
          try (InputStream stream = jar.getInputStream(entry)) {
            for (int n; (n = stream.read(buffer)) != -1;) {
              bytes += n; total += n;
              if (bytes > 134217728L || total > 536870912L) throw new SecurityException();
            }
          }
          if (name.equalsIgnoreCase("META-INF/MANIFEST.MF") || name.matches("(?i)META-INF/[^/]+\\.(SF|RSA|DSA|EC)")) continue;
          CodeSigner[] signers = entry.getCodeSigners();
          if (signers == null || signers.length != 1) throw new SecurityException();
          X509Certificate certificate = (X509Certificate) signers[0].getSignerCertPath().getCertificates().get(0);
          certificate.checkValidity();
          String actual = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded()));
          if (!expected.equals(actual)) throw new SecurityException();
          signed++;
        }
      }
      if (signed == 0) throw new SecurityException();
      System.out.println("{\"allPayloadEntriesSignedByExpectedCertificate\":true,\"signedEntryCount\":" + signed + "}");
    } catch (Exception failure) {
      System.err.println("AAB_SIGNATURE_VALIDATION_FAILED");
      System.exit(1);
    }
  }
}

package com.monokeep.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** One encrypted session shared by the UI and native workers. Never persist the password. */
final class SyncSession {
    private static final String ALIAS = "monokeep.sync.session";
    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("sync-session", Context.MODE_PRIVATE); }
    static String owner(Context c) { return prefs(c).getString("owner", ""); }
    static String email(Context c) { return prefs(c).getString("email", ""); }
    static synchronized JSONObject read(Context c) throws Exception {
        String encoded = prefs(c).getString("encrypted", "");
        if (encoded.isEmpty()) return null;
        String[] pieces = encoded.split(":");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(pieces[0], Base64.NO_WRAP)));
        return new JSONObject(new String(cipher.doFinal(Base64.decode(pieces[1], Base64.NO_WRAP)), java.nio.charset.StandardCharsets.UTF_8));
    }
    static synchronized void save(Context c, JSONObject session) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        String encoded = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" +
            Base64.encodeToString(cipher.doFinal(session.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)), Base64.NO_WRAP);
        JSONObject user = session.getJSONObject("user");
        if (!prefs(c).edit().putString("encrypted", encoded).putString("owner", user.getString("id"))
                .putString("email", user.optString("email")).commit()) throw new IllegalStateException("Cannot save account");
    }
    static synchronized void clear(Context c) {
        if (!prefs(c).edit().clear().commit()) throw new IllegalStateException("Cannot sign out");
    }
    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(ALIAS, null);
    }
}

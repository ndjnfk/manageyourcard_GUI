package com.manageyourcard.android;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createNotificationChannel();
    }

    /**
     * Creates the channel every reminder is posted to.
     *
     * Required from Android 8 (Oreo) onward, and not optional in practice: a
     * notification posted to a channel that does not exist is dropped by the
     * system silently, with no error anywhere the app could see one. FCM does
     * not create the channel named in the manifest — it only names it — so this
     * is the only thing that brings it into existence.
     *
     * Creating it repeatedly is safe. Once a channel exists Android ignores
     * further attempts to create it, and deliberately so: importance and sound
     * belong to the user after the first run, and an app must not be able to
     * quietly turn its own notifications back up.
     */
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationChannel channel = new NotificationChannel(
            getString(R.string.default_notification_channel_id),
            getString(R.string.default_notification_channel_name),
            // DEFAULT, not HIGH: a card falling due in a few days is worth a
            // notification but not a heads-up banner thrown over whatever the
            // shopkeeper is doing. Nothing here is urgent enough to interrupt.
            NotificationManager.IMPORTANCE_DEFAULT
        );

        channel.setDescription(getString(R.string.default_notification_channel_description));

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);
        }
    }
}

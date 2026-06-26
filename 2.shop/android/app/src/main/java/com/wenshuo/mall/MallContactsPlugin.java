package com.wenshuo.mall;

import android.Manifest;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "MallContacts",
    permissions = {
        @Permission(alias = "contacts", strings = { Manifest.permission.READ_CONTACTS })
    }
)
public class MallContactsPlugin extends Plugin {
    private static final String CONTACTS_ALIAS = "contacts";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void getContacts(PluginCall call) {
        if (getPermissionState(CONTACTS_ALIAS) != PermissionState.GRANTED) {
            requestPermissionForAlias(CONTACTS_ALIAS, call, "contactsPermissionCallback");
            return;
        }
        readContactsAsync(call);
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        Uri uri = Uri.fromParts("package", getContext().getPackageName(), null);
        intent.setData(uri);
        getActivity().startActivity(intent);
        call.resolve();
    }

    @PermissionCallback
    private void contactsPermissionCallback(PluginCall call) {
        if (call == null) {
            return;
        }
        if (getPermissionState(CONTACTS_ALIAS) != PermissionState.GRANTED) {
            call.reject("contacts_permission_denied");
            return;
        }
        readContactsAsync(call);
    }

    private void readContactsAsync(PluginCall call) {
        executor.execute(() -> {
            try {
                JSObject result = new JSObject();
                JSArray contacts = readPhoneContacts();
                result.put("contacts", contacts);
                result.put("count", contacts.length());
                getActivity().runOnUiThread(() -> call.resolve(result));
            } catch (Exception ex) {
                getActivity().runOnUiThread(() -> call.reject("contacts_read_failed", ex));
            }
        });
    }

    private JSArray readPhoneContacts() {
        Map<String, ContactBucket> buckets = new LinkedHashMap<>();
        String[] projection = new String[] {
            ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER
        };
        try (Cursor cursor = getContext().getContentResolver().query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            projection,
            null,
            null,
            ContactsContract.CommonDataKinds.Phone.CONTACT_ID + " ASC"
        )) {
            if (cursor == null) {
                return new JSArray();
            }
            int idIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.CONTACT_ID);
            int nameIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME);
            int phoneIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
            while (cursor.moveToNext()) {
                String contactId = safeCursorString(cursor, idIndex);
                String displayName = safeCursorString(cursor, nameIndex).trim();
                String phone = safeCursorString(cursor, phoneIndex).trim();
                if (phone.length() == 0) {
                    continue;
                }
                String key = contactId.length() > 0 ? contactId : displayName + ":" + phone;
                ContactBucket bucket = buckets.get(key);
                if (bucket == null) {
                    bucket = new ContactBucket(contactId, displayName);
                    buckets.put(key, bucket);
                }
                bucket.addPhone(phone);
            }
        }

        JSArray out = new JSArray();
        for (ContactBucket bucket : buckets.values()) {
            if (bucket.phones.isEmpty()) {
                continue;
            }
            JSObject item = new JSObject();
            item.put("contactId", bucket.contactId);
            item.put("displayName", bucket.displayName);
            JSArray phones = new JSArray();
            for (String phone : bucket.phones) {
                phones.put(phone);
            }
            item.put("phones", phones);
            out.put(item);
        }
        return out;
    }

    private String safeCursorString(Cursor cursor, int index) {
        if (index < 0 || cursor.isNull(index)) {
            return "";
        }
        return cursor.getString(index);
    }

    private static class ContactBucket {
        final String contactId;
        final String displayName;
        final List<String> phones = new ArrayList<>();

        ContactBucket(String contactId, String displayName) {
            this.contactId = contactId;
            this.displayName = displayName;
        }

        void addPhone(String phone) {
            if (!phones.contains(phone)) {
                phones.add(phone);
            }
        }
    }
}

import Capacitor
import Contacts
import UIKit

@objc(MallContactsPlugin)
public class MallContactsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MallContactsPlugin"
    public let jsName = "MallContacts"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getContacts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openAppSettings", returnType: CAPPluginReturnPromise),
    ]

    private let store = CNContactStore()

    @objc func getContacts(_ call: CAPPluginCall) {
        let status = CNContactStore.authorizationStatus(for: .contacts)
        if canReadContacts(status) {
            readContacts(call)
            return
        }
        if #available(iOS 18.0, *), status == .limited {
            reject(call, message: "contacts_permission_limited")
            return
        }

        guard status == .notDetermined else {
            reject(call, message: "contacts_permission_denied")
            return
        }

        store.requestAccess(for: .contacts) { [weak self] _, error in
            guard let self else {
                return
            }
            if error != nil {
                self.reject(call, message: "contacts_read_failed")
                return
            }
            let updatedStatus = CNContactStore.authorizationStatus(for: .contacts)
            if self.canReadContacts(updatedStatus) {
                self.readContacts(call)
                return
            }
            if #available(iOS 18.0, *), updatedStatus == .limited {
                self.reject(call, message: "contacts_permission_limited")
                return
            }
            self.reject(call, message: "contacts_permission_denied")
        }
    }

    @objc func openAppSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else {
                call.reject("settings_url_unavailable")
                return
            }
            UIApplication.shared.open(url, options: [:]) { opened in
                if opened {
                    call.resolve()
                }
                else {
                    call.reject("settings_open_failed")
                }
            }
        }
    }

    private func canReadContacts(_ status: CNAuthorizationStatus) -> Bool {
        return status == .authorized
    }

    private func readContacts(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else {
                return
            }
            do {
                let contacts = try self.phoneContacts()
                DispatchQueue.main.async {
                    call.resolve([
                        "contacts": contacts,
                        "count": contacts.count,
                    ])
                }
            }
            catch {
                self.reject(call, message: "contacts_read_failed")
            }
        }
    }

    private func phoneContacts() throws -> JSArray {
        let keys: [CNKeyDescriptor] = [
            CNContactIdentifierKey as CNKeyDescriptor,
            CNContactGivenNameKey as CNKeyDescriptor,
            CNContactMiddleNameKey as CNKeyDescriptor,
            CNContactFamilyNameKey as CNKeyDescriptor,
            CNContactOrganizationNameKey as CNKeyDescriptor,
            CNContactPhoneNumbersKey as CNKeyDescriptor,
        ]
        let request = CNContactFetchRequest(keysToFetch: keys)
        var contacts = JSArray()

        try store.enumerateContacts(with: request) { contact, _ in
            let phones = uniquePhoneValues(contact.phoneNumbers)
            guard !phones.isEmpty else {
                return
            }

            let formattedName = CNContactFormatter.string(from: contact, style: .fullName)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let displayName = formattedName?.isEmpty == false
                ? formattedName!
                : contact.organizationName.trimmingCharacters(in: .whitespacesAndNewlines)
            let item: JSObject = [
                "contactId": contact.identifier,
                "displayName": displayName,
                "phones": phones,
            ]
            contacts.append(item)
        }

        return contacts
    }

    private func uniquePhoneValues(_ values: [CNLabeledValue<CNPhoneNumber>]) -> [String] {
        var seen = Set<String>()
        return values.compactMap { value in
            let phone = value.value.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !phone.isEmpty, seen.insert(phone).inserted else {
                return nil
            }
            return phone
        }
    }

    private func reject(_ call: CAPPluginCall, message: String) {
        DispatchQueue.main.async {
            call.reject(message)
        }
    }
}

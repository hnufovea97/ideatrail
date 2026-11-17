package pathguard

import "strings"

// Fixed exclusions, matched per path component, case-insensitively, on every OS.
var (
	excludeNames = map[string]bool{
		".env": true, ".envrc": true, ".npmrc": true, ".netrc": true, ".pypirc": true, ".pgpass": true,
		".git-credentials": true, ".htpasswd": true, ".ssh": true, ".gnupg": true, ".aws": true,
		".docker": true, ".kube": true, ".git": true, "node_modules": true,
	}
	excludePrefixes = []string{".env.", "id_rsa", "id_ed25519", "id_ecdsa", "id_dsa", "service-account"}
	excludeSuffixes = []string{".env", ".pem", ".key", ".p12", ".pfx", ".p8", ".ppk", ".jks", ".keystore", ".kdbx", ".tfstate"}
	excludeContains = []string{"credentials"}
)

func excluded(rel string) bool {
	lower := strings.ToLower(rel)
	if strings.Contains("/"+lower+"/", "/.config/gcloud/") {
		return true
	}
	for _, part := range strings.Split(lower, "/") {
		if excludeNames[part] {
			return true
		}
		for _, p := range excludePrefixes {
			if strings.HasPrefix(part, p) {
				return true
			}
		}
		for _, s := range excludeSuffixes {
			if strings.HasSuffix(part, s) {
				return true
			}
		}
		for _, c := range excludeContains {
			if strings.Contains(part, c) {
				return true
			}
		}
	}
	return false
}

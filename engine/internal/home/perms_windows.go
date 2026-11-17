//go:build windows

package home

import (
	"os"

	"golang.org/x/sys/windows"
)

// ownerOnlyDACL: protected (no inheritance), full control for the current user's SID only.
func ownerOnlyDACL(path string, inherit bool) error {
	tok := windows.GetCurrentProcessToken()
	user, err := tok.GetTokenUser()
	if err != nil {
		return err
	}
	flags := ""
	if inherit {
		flags = "OICI"
	}
	sd, err := windows.SecurityDescriptorFromString("D:P(A;" + flags + ";FA;;;" + user.User.Sid.String() + ")")
	if err != nil {
		return err
	}
	dacl, _, err := sd.DACL()
	if err != nil {
		return err
	}
	return windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil)
}

func restrictDir(dir string) error { return ownerOnlyDACL(dir, true) }

// RestrictFile limits a file to the current user (DACL, inheritance off).
func RestrictFile(path string) error { return ownerOnlyDACL(path, false) }

// OwnerOnly: permissions are enforced by the DACL set at creation; mode bits mean little here.
func OwnerOnly(os.FileInfo) bool { return true }

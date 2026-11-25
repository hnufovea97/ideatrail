package main

import "errors"

var errBadCode = errors.New("cannot show device code")

// errStateUnreadable: the state file exists but cannot be read, so the pinned key cannot be checked.
var errStateUnreadable = errors.New("state file unreadable")

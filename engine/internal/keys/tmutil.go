package keys

import "os/exec"

var tmutilExclude = func(path string) error { return exec.Command("/usr/bin/tmutil", "addexclusion", path).Run() }

package config

import (
	"strings"
	"testing"
)

// The production Worker serves the API and the web on one origin (cookies are SameSite=Strict).
func TestProductionDefaultsShareOneHTTPSOrigin(t *testing.T) {
	if APIBase != ProductionBase || AppBase != ProductionBase {
		t.Fatalf("API %q and app %q must both be the production origin %q", APIBase, AppBase, ProductionBase)
	}
	if !strings.HasPrefix(ProductionBase, "https://") || strings.Contains(ProductionBase, "staging") || strings.HasSuffix(ProductionBase, "/") {
		t.Fatalf("production origin looks wrong: %q", ProductionBase)
	}
}

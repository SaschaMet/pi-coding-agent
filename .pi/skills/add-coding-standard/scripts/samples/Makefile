check-fast:
	npm run lint
	npm run typecheck
	npm run test

check-full: check-fast
	$(MAKE) test-coverage
	$(MAKE) dup-check
	$(MAKE) ai-risk-check

ci-verify: check-full
	$(MAKE) audit

test-coverage:
	@echo "Replace with the repo coverage command."

dup-check:
	cpd . --reporters console,threshold --threshold 5 --output reports/jscpd

audit:
	@echo "Replace with the repo dependency and secret audit commands."

ai-risk-check:
	@echo "Replace with warning-mode AI-risk and cleanup guard scripts."

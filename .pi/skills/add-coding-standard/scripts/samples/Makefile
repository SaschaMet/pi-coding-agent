check-fast:
	./scripts/run-coding-standard.sh --mode pre-commit --strict

check-full: check-fast
	$(MAKE) test-coverage

ci-verify: check-full
	$(MAKE) audit
	$(MAKE) ai-risk-check

test-coverage:
	@echo "Replace with the repo coverage command."

audit:
	@echo "Replace with the repo dependency and secret audit commands."

ai-risk-check:
	@echo "Replace with warning-mode AI-risk and cleanup guard scripts."

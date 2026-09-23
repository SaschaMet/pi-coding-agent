# Subagent Rules

You run as a subagent: another agent spawned you, and no human watches this session. These rules override `.pi/SYSTEM.md` where they conflict. All other SYSTEM.md rules still apply.

# Approval and Scope

- The parent's task message is your approval. Do not wait for approval, ask questions, or offer choices.
- Coding Workflow steps 2 (Orchestrate), 5 (Grill), and 6 (Approve) belong to the parent. Skip them. TDD (`$tdd`) and scope rules still apply.
- Never spawn subagents or cmux workers. Do not use `$cmux-orchestration`.
- Put scratch and report files under `$TMPDIR/pi-reports/`. Other paths outside the project are blocked in your session.
- If the task is ambiguous: take the most conservative reading and state it in your report. If no safe reading exists: stop and report.

# When to Stop

Stop only when one of these holds:

1. The task is done and verified.
2. The next step needs a decision only the parent can make.
3. The next step is destructive or outside scope. Report it. Do not do it.
4. The stop-and-report rule fires.
5. A tool or guard blocks an action. Report the block. Do not reach the same result another way.

Never end a turn in these ways while work is still owed:

1. A summary that announces the next step but makes no tool call.
2. An offer to continue unless told otherwise.
3. A list of decisions when none of them blocks the rest of the work.
4. A pause because the turn was long or a milestone is done.

Put status notes in the same message as your next tool call.

# Time and Report

- A `[time: N s elapsed of M s budget]` tag at the end of a message means N seconds have passed since the parent started and the whole task has M seconds. Pace your work to finish inside M. `[time: N s elapsed]` means no budget: finish as soon as you correctly can. The budget is advisory: correctness wins. The tag is never part of a command in the message.
- Final report: what changed, the verification output, and open blockers. Use the sentinel, file path, or format the task names.

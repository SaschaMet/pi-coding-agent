---
name: expert-intake
description: Step back and take the role of the professional who would handle the case. Derive the questions that person would ask to get the missing facts, reach the root of the issue, or solve it. Use when the user says "what would an expert ask", "welche Fragen würde ein Berater stellen", "think like a lawyer/doctor/auditor", or prepares a meeting with a professional. Not for a task going in circles (use step-back) or a fresh task with no material (use explore).
---

# Expert intake

Stop solving. Take the role of the professional who would handle this case. Derive the questions that person asks before giving any advice.

The user's material usually holds the user's questions to the professional. A professional works the other way: facts first, then judgment. This skill produces the professional's questions to the user.

## Rules

- Give no advice and no solution in this step. Questions and known answers are the output.
- Read every available source first: project docs, connected folders, earlier turns. Never ask what a source already answers.
- Every prefilled answer names its source (a file, a message, a quote). Label general rules "principle" and your own conclusions "inferred".
- Every question states what depends on its answer. That is why the professional asks it.
- Separate facts from judgment. The user answers fact questions. The professional answers judgment questions.
- Say once that you are not this professional and that principles come from general knowledge unless you looked them up.
- Change no existing document. Propose changes as a diff and wait.
- Plain language per the eli5 Style rules. Reply in the conversation's language.

## Procedure

1. **Role.** Name the professional. If the case spans several fields, name one per field. State whose interests each represents and what each is liable for.
2. **Where we are.** The task, the material that exists, and why it does not yet serve the professional.
3. **Terms.** Define each key term once, in one short clause.
4. **Split the issue.** Break each vague issue into the separate questions the professional treats separately. Example: "Must my employer open a branch abroad?" is four questions: profit tax, wage tax, social insurance, company register.
5. **Order.** Sort as the professional would: first deadlines and irreversible risks, then facts everything else depends on, then the rest.
6. **Criteria, then questions.** For each issue, state the criteria that decide it (principle). Then write the questions that test each criterion. Three to eight questions per issue.
7. **Prefill.** Answer each question from the sources where possible. Give each a status:
   - evidenced: a document carries the answer
   - own statement: the user said it, no document
   - open: the user must answer or find it
   - open with third party: only someone else knows (name them)
   - for the professional: a judgment question
8. **Contradictions.** List every point where sources contradict each other or the user's account. The professional will find them, so the user should raise them first.
9. **Blind spots.** Add the questions the user did not think of: other parties with their own interests, other income or assets, earlier contact with authorities, who the client is, conflicts of interest.
10. **Conclusion.** State the next artifact's single job in one sentence, then its skeleton: one block per issue, each question with answer, evidence and status.
11. **Check.** End with one yes/no question: do role, order and questions hold, so the questionnaire can be built?

## After the user says yes

- Build the questionnaire as a new document. Keep it facts only. Leave judgment, costs and plans in the user's existing material.
- One table per issue: number, question, answer, evidence, status.
- End with a table of new findings and contradictions, and a short list of next steps. Each step says what happens, why, and how it is checked.
- Offer to read the documents that would close open rows.

## Done when

- Every question states what depends on it.
- No prefilled answer lacks a source and a status.
- Contradictions between sources are listed.
- No advice was given and no existing document was changed.
- The last line is the yes/no question.

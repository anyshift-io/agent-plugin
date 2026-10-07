# Agent instructions

## Manually validating pull requests

Same-repository pull requests do not start validation automatically. Fork pull requests run validation automatically with a read-only token because their branches cannot be selected for manual dispatch. For same-repository pull requests, run each required workflow against the latest commit before merging. A new commit requires fresh successful checks.

- **GitHub UI:** Open **Actions**, select the workflow, choose **Run workflow**, select the same-repository pull request branch, provide any required inputs, and start the run. Manual dispatch is available once the workflow is present on the default branch.
- **GitHub CLI:** Agents can run the workflow on a same-repository pull request branch:

  ```sh
  gh workflow run <workflow-file> --ref <pr-branch> --repo anyshift-io/agent-plugin -f name=value
  ```

Replace `<workflow-file>` and `<pr-branch>` with the workflow path and current PR branch. Add `-f name=value` for each required workflow input. Confirm every required status has passed on the current PR head before merging. Fork pull requests use the automatic read-only validation path instead.

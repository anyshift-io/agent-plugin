# Agent instructions

## Manually validating pull requests

GitHub Actions validation workflows in this repository do not start automatically when a pull request opens or receives a commit. Run each required workflow against the pull request's latest commit before merging. A new commit requires fresh successful checks.

- **GitHub UI:** After this change is merged to the default branch, open **Actions**, select the workflow, choose **Run workflow**, select the pull request branch, provide any required inputs, and start the run.
- **GitHub CLI:** Agents can run the workflow on the pull request branch before or after merge:

  ```sh
  gh workflow run <workflow-file> --ref <pr-branch> --repo anyshift-io/agent-plugin -f name=value
  ```

Replace `<workflow-file>` and `<pr-branch>` with the workflow path and current PR branch. Add `-f name=value` for each required workflow input. Confirm every required status has passed on the current PR head before merging.

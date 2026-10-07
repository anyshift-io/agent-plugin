# Agent instructions

## Manually validating pull requests

Pull requests do not start validation automatically, including pull requests from forks. The required `validate` check is the GitHub Actions job check on the commit selected for manual dispatch. A new commit requires a fresh successful run.

- **GitHub UI:** Open **Actions**, select the workflow, choose **Run workflow**, select the pull request branch in this repository, provide any required inputs, and start the run.
- **GitHub CLI:** Agents can run the workflow on a pull request branch in this repository:

  ```sh
  gh workflow run <workflow-file> --ref <pr-branch> --repo anyshift-io/agent-plugin -f name=value
  ```

Replace `<workflow-file>` and `<pr-branch>` with the workflow path and current PR branch. Add `-f name=value` for each required workflow input. Confirm the `validate` job check has passed on the exact PR head before merging. A fork branch cannot be selected for dispatch from this repository; validate it only after its commit is available on a branch in this repository.

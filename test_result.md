#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: "Wayly mobile app - mirror web app feature parity. Currently retrofitting the 4 existing AI tools (budget-calc, price-checker, classification-check, reassessment-letter) with plan gating components (<ToolGate>, <AIAccuracyBanner>) and finalising Stripe checkout flow with deep-linking."

frontend:
  - task: "app.json deep-link scheme + bundle identifiers"
    implemented: true
    working: true
    file: "frontend/app.json"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: true
          agent: "main"
          comment: "Confirmed scheme: 'wayly' already set. Updated bundleIdentifier (iOS) and package (Android) to au.wayly.app per master prompt. Required for Stripe Checkout return via wayly:// deep link."

  - task: "ToolGate + AIAccuracyBanner retrofit on 4 existing tools"
    implemented: true
    working: "NA"
    file: "frontend/app/tools/{budget-calc,price-checker,classification-check,reassessment-letter}.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Added useAuth + hasPaidAccess gating; if user is free/unauth, render <ToolGate variant='free-plan'|'unauth'> with the appropriate disclaimer banner. Added <AIAccuracyBanner tool='...'> at top of each tool's hero. Verified files compile (Metro bundler clean restart). Auth gating means we need to be logged-in-as-paid to fully test the calc flows; gate-state UI can be tested when logged in as free user."

  - task: "PayMethodBadges on Plan & Billing"
    implemented: true
    working: "NA"
    file: "frontend/app/settings/plan.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Added <PayMethodBadges /> below the Stripe security note. Existing Stripe checkout flow (WebBrowser.openAuthSessionAsync + session polling + auth refresh) was already implemented previously."

metadata:
  created_by: "main_agent"
  version: "1.1"
  test_sequence: 3
  run_ui: false

test_plan:
  current_focus:
    - "ToolGate + AIAccuracyBanner retrofit on 4 existing tools"
    - "PayMethodBadges on Plan & Billing"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    - agent: "main"
      message: "Retrofit complete for the 4 remaining AI tools. ToolGate appears for free/unauth users; tool body only renders when hasPaidAccess(user)===true (paid plan or trialing). app.json bundleId/package updated to au.wayly.app. PayMethodBadges added to plan.tsx. App bundler restarts cleanly (no syntax errors). Did NOT run testing agent yet — awaiting user confirmation on whether to test now or proceed to next batch (push notifications, accessibility widget, crisis hotlines footer, axios error toast interceptor)."

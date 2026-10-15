const GROUPS = Object.freeze({
  SCIENCE: "Science",
  HUMANITIES: "Humanities",
  BUSINESS_STUDIES: "BusinessStudies",
});

const GROUP_LABELS = Object.freeze({
  [GROUPS.SCIENCE]: "Science",
  [GROUPS.HUMANITIES]: "Humanities (Arts)",
  [GROUPS.BUSINESS_STUDIES]: "Business Studies (Commerce)",
});

function normalizeAcademicGroup(value) {
  const key = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!key) return "";
  if (key === "science") return GROUPS.SCIENCE;
  if (key === "humanities" || key === "arts" || key === "art") return GROUPS.HUMANITIES;
  if (key === "businessstudies" || key === "businessstudy" || key === "commerce" || key === "business") {
    return GROUPS.BUSINESS_STUDIES;
  }
  return "";
}

function normalizeClassName(value) {
  return String(value || "").trim();
}

function hasCompleteAcademicProfile(user) {
  return Boolean(user?.className && normalizeAcademicGroup(user.group) && user?.academicYear);
}

function groupsMatch(memberGroup, allowedGroups = []) {
  const normalizedMemberGroup = normalizeAcademicGroup(memberGroup);
  return Boolean(normalizedMemberGroup && allowedGroups.map(normalizeAcademicGroup).includes(normalizedMemberGroup));
}

module.exports = {
  GROUPS,
  GROUP_LABELS,
  normalizeAcademicGroup,
  normalizeClassName,
  hasCompleteAcademicProfile,
  groupsMatch,
};

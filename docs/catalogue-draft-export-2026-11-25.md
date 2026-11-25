# Atlas draft product catalogue

**Exported:** 25 November 2026  
**Status:** draft, not published. A claim marked `Pending review` has not been signed by a named reviewer and blocks publication of that version.

This export is generated from the two draft catalogue files: `content/catalogue/electricity_network/2.json` and `content/catalogue/any_organisation/2.json`. It is for reading and review; the JSON files remain the source.

## Contents

- [At a glance](#at-a-glance)
- [Electricity network](#electricity-network)
- [Any organisation](#any-organisation)
- [How to read the review state](#how-to-read-the-review-state)

## At a glance

| Sector | Version | Pinned map | Entries | Capabilities covered | Entries pending review |
| --- | ---: | ---: | ---: | ---: | ---: |
| Electricity network | 2 | v4 | 28 | 23 of 84 | 18 |
| Any organisation | 2 | v2 | 12 | 38 of 70 | 12 |

## Electricity network

**Version:** 2 · **Pinned map:** v4 · **Entries:** 28 · **Coverage:** 23 of 84 capabilities · **Pending review:** 18 of 28 entries

**Description:** Version 2, checked 25 November 2026. It corrects broken and redirected source links, updates products that have been renamed or sold (Octave Attune EAM, formerly HxGN EAM; Siemens Gridscale X Meter Data Management, formerly EnergyIP; Oracle Utilities Customer Service and Billing; Salesforce Field Service and Operations), adds capability links the vendor page already supports, and adds reviewed-candidate products for previously uncovered capabilities. Every new or changed claim is Pending review until a named reviewer signs it; unchanged claims keep their original review. Coverage is deliberately a first slice.

### Coverage

| Code | Capability | Products |
| --- | --- | --- |
| 5 | Customer Contact | Salesforce Service Cloud; Microsoft Dynamics 365 Customer Service; Oracle Utilities Customer Service and Billing |
| 5.1 | Contact Channels | Genesys Cloud CX |
| 5.3 | Case & Request Tracking | Salesforce Service Cloud; Microsoft Dynamics 365 Customer Service |
| 5.4 | Complaints & Feedback | Salesforce Service Cloud; Microsoft Dynamics 365 Customer Service |
| 9 | Asset Management | Esri ArcGIS Utility Network; GE Vernova Smallworld Geo Network Management |
| 9.1 | Network Asset Health Indices | IBM Maximo Application Suite; IFS Copperleaf; Cascade |
| 9.2 | Network Investment Planning | IBM Maximo Application Suite; IFS Copperleaf |
| 9.3 | Substation & Circuit Condition Monitoring | DynamicMetrix; Cascade |
| 9.4 | Network Planning & Load Forecasting | Esri ArcGIS Utility Network; GE Vernova Smallworld Geo Network Management; LAEP+ |
| 9.5 | Asset Inspection & Maintenance | IBM Maximo Application Suite; SAP Asset Management; Octave Attune EAM |
| 10.1 | Outage & Fault Management | Schneider Electric EcoStruxure ADMS; GE Vernova GridOS for Distribution |
| 10.2 | Connections | IDNO itc; LAEP+ |
| 10.5 | Flexibility Markets | Piclo |
| 10.6 | Control Room & Real-Time Operations | Schneider Electric EcoStruxure ADMS; GE Vernova GridOS for Distribution |
| 11.1 | Smart Metering Data | Siemens Gridscale X Meter Data Management; Oracle Utilities Meter Data Management |
| 11.4 | Connection Quotations | Microsoft Dynamics 365 Customer Service; Salesforce Energy & Utilities Cloud |
| 11.5 | Billing & Settlement | Oracle Utilities Customer Service and Billing |
| 11.6 | Vulnerable Customer Support | TellJO Customer Wellbeing Checks |
| 13.1 | Capital Projects & Construction | Oracle Primavera Unifier; Oracle Primavera P6; Microsoft Project |
| 13.2 | Planned Maintenance & Inspection | IBM Maximo Application Suite; Octave Attune EAM; Cascade; Utility Works Management |
| 13.3 | Field Workforce Scheduling & Dispatch | Microsoft Dynamics 365 Field Service; Salesforce Field Service and Operations |
| 13.6 | Vegetation Management | KaarbonTech Tree SMART |
| 13.7 | Contractor Management | Utility Works Management |

### Entries

#### 1. Salesforce Service Cloud — Salesforce

`salesforce-service-cloud` · claims reviewed

Customer service and case management across contact channels, used by utilities to handle customer contact, complaints and outage enquiries.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 5 | Customer Contact | Holds the customer record and service cases across channels, including contact during an outage. |
| 5.4 | Complaints & Feedback | Records complaints and feedback as cases with an owner and history. |
| 5.3 | Case & Request Tracking | Records customer requests and complaints as cases with an owner and history. |

**Claims**

- **functional.** The vendor describes the product for customer service cases and contact across channels.
  - Source: [https://www.salesforce.com/service/cloud/](https://www.salesforce.com/service/cloud/) — checked 2026-11-21
  - Reviewer: Simon Parkinson — 2026-11-21
- **functional.** The vendor describes complaint and feedback handling as part of customer service.
  - Source: [https://www.salesforce.com/service/cloud/](https://www.salesforce.com/service/cloud/) — checked 2026-11-21
  - Reviewer: Simon Parkinson — 2026-11-21

#### 2. Microsoft Dynamics 365 Customer Service — Microsoft

`microsoft-d365-customer-service` · claims reviewed

Customer service, case management and contact handling, positioned for organisations that need a single view of the customer.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 5 | Customer Contact | Holds the customer record and service cases across channels, including contact during an outage. |
| 5.4 | Complaints & Feedback | Records complaints and feedback as cases with an owner and history. |
| 11.4 | Connection Quotations | Can record and track a connection enquiry as a customer case. |
| 5.3 | Case & Request Tracking | Records customer requests as cases with an owner and history. |

**Claims**

- **functional.** The vendor describes the product for customer service and case management.
  - Source: [https://www.microsoft.com/en-us/dynamics-365/products/customer-service](https://www.microsoft.com/en-us/dynamics-365/products/customer-service) — checked 2026-11-21
  - Reviewer: Simon Parkinson — 2026-11-21

#### 3. Genesys Cloud CX — Genesys

`genesys-cloud-cx` · claims reviewed

Contact-centre routing across voice and digital channels, the channel layer beneath a customer service record.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 5.1 | Contact Channels | Routes voice and digital contact to the right queue or agent. |

**Claims**

- **functional.** The vendor describes the product for contact-centre routing across voice and digital channels.
  - Source: [https://www.genesys.com/genesys-cloud](https://www.genesys.com/genesys-cloud) — checked 2026-11-21
  - Reviewer: Simon Parkinson — 2026-11-21

#### 4. Salesforce Energy & Utilities Cloud — Salesforce

`salesforce-energy-utilities` · **claims pending review**

An energy and utilities customer platform for customer service, complex multi-site quoting and connection milestone tracking.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 11.4 | Connection Quotations | Positions connection enquiries and customer journeys as part of utility customer operations. |

**Claims**

- **functional.** The vendor describes Energy & Utilities Cloud for quoting complex multi-site deals and tracking every new connection from intake to closeout on one timeline.
  - Source: [https://www.salesforce.com/energy-utilities/cloud/](https://www.salesforce.com/energy-utilities/cloud/) — checked 2026-11-25
  - Reviewer: Pending review — 2026-11-25

#### 5. Oracle Utilities Customer Service and Billing — Oracle

`oracle-ccb` · **claims pending review**

Customer service, billing and advanced metering for utility customer accounts.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 11.5 | Billing & Settlement | The vendor describes billing as a core part of the product's utility customer care scope. |
| 5 | Customer Contact | Connects customer care and account data across service channels. |

**Claims**

- **functional.** The vendor describes Oracle Utilities Customer Service and Billing as connecting customer care, billing and advanced metering.
  - Source: [https://www.oracle.com/utilities/customer-service/](https://www.oracle.com/utilities/customer-service/) — checked 2026-11-25
  - Reviewer: Pending review — 2026-11-25

#### 6. Schneider Electric EcoStruxure ADMS — Schneider Electric

`schneider-adms` · **claims pending review**

An advanced distribution management system that combines distribution management, outage management and SCADA for network operations.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 10.1 | Outage & Fault Management | Describes distribution management and outage operations in one system. |
| 10.6 | Control Room & Real-Time Operations | Describes real-time control-room operation of the distribution network. |

**Claims**

- **functional.** The vendor describes EcoStruxure ADMS as merging distribution management, outage management and SCADA into one network management solution.
  - Source: [https://www.se.com/us/en/product-range/61751-ecostruxure-adms/](https://www.se.com/us/en/product-range/61751-ecostruxure-adms/) — checked 2026-11-25
  - Reviewer: Pending review — 2026-11-25

#### 7. GE Vernova GridOS for Distribution — GE Vernova

`ge-gridos` · **claims pending review**

Grid operations software for distribution management, outage response and real-time network control.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 10.1 | Outage & Fault Management | Describes grid operations and outage response. |
| 10.6 | Control Room & Real-Time Operations | Describes real-time operation of the distribution network. |

**Claims**

- **functional.** The vendor describes GridOS for Distribution as software for distribution management, outage response and real-time network operations.
  - Source: [https://gevernova.com/software/products/gridos-for-distribution](https://gevernova.com/software/products/gridos-for-distribution) — checked 2026-11-25
  - Reviewer: Pending review — 2026-11-25

#### 8. IBM Maximo Application Suite — IBM

`ibm-maximo` · claims reviewed

Asset management and maintenance software for physical assets, including inspection and work management.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 9.5 | Asset Inspection & Maintenance | Describes asset management, maintenance and inspection of physical assets. |
| 9.1 | Network Asset Health Indices | Uses asset condition and performance data to support health and reliability views. |
| 9.2 | Network Investment Planning | Connects asset condition, risk and financial impact to support investment planning. |
| 13.2 | Planned Maintenance & Inspection | Brings maintenance planning, scheduling and inspections into one workflow. |

**Claims**

- **functional.** The vendor describes the product for asset management and maintenance.
  - Source: [https://www.ibm.com/products/maximo](https://www.ibm.com/products/maximo) — checked 2026-11-21
  - Reviewer: Simon Parkinson — 2026-11-21

#### 9. SAP Asset Management — SAP

`sap-asset-management` · claims reviewed

Enterprise asset management for maintenance planning, work orders and asset inspection.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 9.5 | Asset Inspection & Maintenance | Describes maintenance planning and asset inspection as part of enterprise asset management. |

**Claims**

- **functional.** The vendor describes the product for enterprise asset management and maintenance.
  - Source: [https://www.sap.com/products/erp/asset-management.html](https://www.sap.com/products/erp/asset-management.html) — checked 2026-11-21
  - Reviewer: Simon Parkinson — 2026-11-21

#### 10. Octave Attune EAM — Octave

`octave-attune-eam` · **claims pending review**

Cloud-based enterprise asset management for maintenance, work orders and asset lifecycle records.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 9.5 | Asset Inspection & Maintenance | Describes maintenance and inspection of physical assets. |
| 13.2 | Planned Maintenance & Inspection | Manages maintenance, work orders and inspections for physical assets. |

**Claims**

- **functional.** Octave describes Attune EAM, formerly HxGN EAM, as a cloud-based enterprise asset management solution for maintenance, work orders and asset lifecycles.
  - Source: [https://www.octave.com/products/asset-performance-management/attune/eam](https://www.octave.com/products/asset-performance-management/attune/eam) — checked 2026-11-25
  - Reviewer: Pending review — 2026-11-25

#### 11. Esri ArcGIS Utility Network — Esri

`esri-arcgis-utility-network` · **claims pending review**

A geographic information system for utility networks, used to hold network connectivity and support planning.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 9.4 | Network Planning & Load Forecasting | Holds network connectivity and geography used in planning work. |
| 9 | Asset Management | Records network assets and their connections in a geographic model. |

**Claims**

- **functional.** The vendor describes ArcGIS for energy utility network management, including a digital twin and network planning.
  - Source: [https://www.esri.com/en-us/industries/utilities](https://www.esri.com/en-us/industries/utilities) — checked 2026-11-25
  - Reviewer: Pending review — 2026-11-25

#### 12. GE Vernova Smallworld Geo Network Management — GE Vernova

`ge-smallworld` · **claims pending review**

Geospatial network management for utilities, holding the physical asset network model and connectivity.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 9.4 | Network Planning & Load Forecasting | Holds network models and geography used in planning work. |
| 9 | Asset Management | Records network assets and their connections in a network model. |

**Claims**

- **functional.** The vendor describes Smallworld Geo Network Management as a geospatial system of record for utility network asset models.
  - Source: [https://gevernova.com/software/products/geospatial-network-management-smallworld-gis](https://gevernova.com/software/products/geospatial-network-management-smallworld-gis) — checked 2026-11-25
  - Reviewer: Pending review — 2026-11-25

#### 13. Microsoft Dynamics 365 Field Service — Microsoft

`microsoft-d365-field-service` · claims reviewed

Field service management for scheduling, dispatching and completing work orders for technicians.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 13.3 | Field Workforce Scheduling & Dispatch | Describes scheduling and dispatch of field technicians and work orders. |

**Claims**

- **functional.** The vendor describes the product for scheduling and dispatching field technicians.
  - Source: [https://www.microsoft.com/en-us/dynamics-365/products/field-service](https://www.microsoft.com/en-us/dynamics-365/products/field-service) — checked 2026-11-21
  - Reviewer: Simon Parkinson — 2026-11-21

#### 14. Salesforce Field Service and Operations — Salesforce

`salesforce-field-service` · **claims pending review**

Field service scheduling, dispatch and work-order management on the vendor customer platform.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 13.3 | Field Workforce Scheduling & Dispatch | Describes scheduling, dispatch and work orders for field service teams. |

**Claims**

- **functional.** The vendor describes Field Service and Operations for scheduling, dispatch and work-order management.
  - Source: [https://www.salesforce.com/service/field-service-management/](https://www.salesforce.com/service/field-service-management/) — checked 2026-11-25
  - Reviewer: Pending review — 2026-11-25

#### 15. Oracle Primavera Unifier — Oracle

`oracle-primavera-unifier` · claims reviewed

Capital project and programme controls: planning, approval and reporting across a portfolio of projects.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 13.1 | Capital Projects & Construction | Describes portfolio-level project controls and capital planning. |

**Claims**

- **functional.** The vendor describes the product for capital project and programme controls.
  - Source: [https://www.oracle.com/construction-engineering/primavera-unifier-project-controls-asset-management/](https://www.oracle.com/construction-engineering/primavera-unifier-project-controls-asset-management/) — checked 2026-11-21
  - Reviewer: Simon Parkinson — 2026-11-21

#### 16. Oracle Primavera P6 — Oracle

`oracle-primavera-p6` · claims reviewed

Project scheduling and delivery management for capital projects, including dependencies and milestones.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 13.1 | Capital Projects & Construction | Describes project scheduling and delivery for capital work. |

**Claims**

- **functional.** The vendor describes the product for project scheduling and delivery.
  - Source: [https://www.oracle.com/construction-engineering/primavera-p6/](https://www.oracle.com/construction-engineering/primavera-p6/) — checked 2026-11-21
  - Reviewer: Simon Parkinson — 2026-11-21

#### 17. Microsoft Project — Microsoft

`microsoft-project` · claims reviewed

Project planning and scheduling, with tasks, dependencies and milestones for delivery teams.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 13.1 | Capital Projects & Construction | Describes project planning and scheduling for delivery teams. |

**Claims**

- **functional.** The vendor describes the product for project planning and scheduling.
  - Source: [https://www.microsoft.com/en-us/microsoft-365/project/project-management-software](https://www.microsoft.com/en-us/microsoft-365/project/project-management-software) — checked 2026-11-21
  - Reviewer: Simon Parkinson — 2026-11-21

#### 18. Siemens Gridscale X Meter Data Management — Siemens

`siemens-gridscale-x-mdm` · **claims pending review**

Meter data management for validating, estimating and editing smart meter readings.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 11.1 | Smart Metering Data | Describes collection and processing of smart meter data. |

**Claims**

- **functional.** Siemens describes Gridscale X Meter Data Management, formerly EnergyIP MDM, for meter data validation, estimation and editing (VEE) and billing accuracy.
  - Source: [https://www.siemens.com/en-us/products/gridscale-x/meter-data-management/](https://www.siemens.com/en-us/products/gridscale-x/meter-data-management/) — checked 2026-11-25
  - Reviewer: Pending review — 2026-11-25

#### 19. Oracle Utilities Meter Data Management — Oracle

`oracle-mdm` · claims reviewed

Meter data management for collecting, validating and storing readings from smart and traditional meters.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 11.1 | Smart Metering Data | Describes collection, validation and storage of meter readings. |

**Claims**

- **functional.** The vendor describes the product for meter data management.
  - Source: [https://www.oracle.com/utilities/meter-data-management/](https://www.oracle.com/utilities/meter-data-management/) — checked 2026-11-21
  - Reviewer: Simon Parkinson — 2026-11-21

#### 20. Piclo — Piclo

`piclo` · **claims pending review**

An independent marketplace for energy flexibility, connecting network operators with flexibility providers.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 10.5 | Flexibility Markets | Brings buyers and sellers of flexibility together in one marketplace. |

**Claims**

- **functional.** The vendor describes Piclo as the independent marketplace for energy flexibility.
  - Source: [https://piclo.com/](https://piclo.com/) — checked 2026-11-25
  - Reviewer: Pending review — 2026-11-25

#### 21. IDNO itc — C&C Group

`candc-idno-itc` · **claims pending review**

A cloud-ready platform for independent distribution network operators to manage developments, metering points, MPANs and network connections.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 10.2 | Connections | Manages developments, metering points and network connections. |

**Claims**

- **functional.** The vendor describes IDNO itc as a platform for independent distribution network operators to manage developments, metering points, MPANs and network connections.
  - Source: [https://web.candc-uk.com/idno-product-suite](https://web.candc-uk.com/idno-product-suite) — checked 2026-11-25
  - Reviewer: Pending review — 2026-11-25

#### 22. LAEP+ — Advanced Infrastructure

`advanced-infrastructure-laep` · **claims pending review**

A net zero planning platform for DNOs and local authorities, with connections and customer planning portals.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 10.2 | Connections | Provides a customer connections portal for self-serve connection quotes. |
| 9.4 | Network Planning & Load Forecasting | Supports regional energy planning and network forecasting. |

**Claims**

- **functional.** The vendor describes LAEP+ for DNOs as a planning platform with a Customer Connections Portal for self-serve quotes and a Customer Planning Portal for network planning.
  - Source: [https://advanced-infrastructure.co.uk/distribution-network-operators](https://advanced-infrastructure.co.uk/distribution-network-operators) — checked 2026-11-25
  - Reviewer: Pending review — 2026-11-25

#### 23. IFS Copperleaf — IFS

`ifs-copperleaf` · **claims pending review**

Asset investment planning software for electric utilities, using CNAIM risk modelling to prioritise capital investment.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 9.1 | Network Asset Health Indices | Applies CNAIM risk and health modelling to distribution assets. |
| 9.2 | Network Investment Planning | Optimises capital investment plans across the network. |

**Claims**

- **functional.** The vendor describes IFS Copperleaf as asset investment planning software for electric utilities, using CNAIM risk modelling to prioritise capital investment.
  - Source: [https://copperleaf.com/solutions-for-industry/electric-utilities-asset-investment-planning](https://copperleaf.com/solutions-for-industry/electric-utilities-asset-investment-planning) — checked 2026-11-25
  - Reviewer: Pending review — 2026-11-25

#### 24. DynamicMetrix — Dynamic Ratings

`dynamic-ratings-dynamicmetrix` · **claims pending review**

A dashboard that consolidates condition monitoring data from transformers, circuit breakers and switchgear.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 9.3 | Substation & Circuit Condition Monitoring | Consolidates condition monitoring from substation equipment into one dashboard. |

**Claims**

- **functional.** The vendor describes DynamicMetrix as a dashboard that collects condition monitoring data from transformers, circuit breakers and switchgear into one view.
  - Source: [https://dynamicratings.com/products/dynamicmetrix](https://dynamicratings.com/products/dynamicmetrix) — checked 2026-11-25
  - Reviewer: Pending review — 2026-11-25

#### 25. Cascade — DNV

`dnv-cascade` · **claims pending review**

Utility asset management software that calculates asset health, criticality and risk from condition and maintenance data.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 9.1 | Network Asset Health Indices | Calculates asset health, criticality and risk indices. |
| 9.3 | Substation & Circuit Condition Monitoring | Consolidates condition monitoring for transformers, breakers and line assets. |
| 13.2 | Planned Maintenance & Inspection | Plans maintenance and inspections from asset condition and risk. |

**Claims**

- **functional.** DNV describes Cascade as utility asset management software that calculates asset health, criticality and risk from condition and maintenance data.
  - Source: [https://dnv.com/services/electric-utility-asset-management-software-cascade-viewer-143263](https://dnv.com/services/electric-utility-asset-management-software-cascade-viewer-143263) — checked 2026-11-25
  - Reviewer: Pending review — 2026-11-25

#### 26. Utility Works Management — Totalmobile

`totalmobile-uwm` · **claims pending review**

Cloud-based work order management for utility contractors and subcontractors across multiple contracts.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 13.7 | Contractor Management | Manages contractor and subcontractor work orders across multiple contracts. |
| 13.2 | Planned Maintenance & Inspection | Plans and tracks repair and maintenance works. |

**Claims**

- **functional.** The vendor describes Utility Works Management as cloud-based work order management for utility contractors and subcontractors to manage multiple contracts in one system.
  - Source: [https://totalmobile.com/software/utility-works-management](https://totalmobile.com/software/utility-works-management) — checked 2026-11-25
  - Reviewer: Pending review — 2026-11-25

#### 27. TellJO Customer Wellbeing Checks — TellJO

`telljo` · **claims pending review**

Digital wellbeing checks that help organisations identify, engage and support customers experiencing vulnerability.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 11.6 | Vulnerable Customer Support | Identifies and supports customers experiencing vulnerability through wellbeing checks. |

**Claims**

- **functional.** TellJO describes its customer wellbeing checks as helping organisations identify, engage and support customers experiencing vulnerability.
  - Source: [https://telljo.org/](https://telljo.org/) — checked 2026-11-25
  - Reviewer: Pending review — 2026-11-25

#### 28. KaarbonTech Tree SMART — KaarbonTech

`kaarbontech-tree-smart` · **claims pending review**

Tree stock management software for risk-based surveying, inspection and maintenance; not utility-specific.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 13.6 | Vegetation Management | Manages tree stock surveys, inspections and risk-based maintenance; not utility-specific. |

**Claims**

- **functional.** The vendor describes its tree software as complete management software for a risk-based approach to tree stock surveying and management.
  - Source: [https://kaarbontech.co.uk/trees](https://kaarbontech.co.uk/trees) — checked 2026-11-25
  - Reviewer: Pending review — 2026-11-25

### Still uncovered

61 of 84 capabilities have no product.

| Area | Uncovered capabilities |
| --- | --- |
| 1 Finance | 1 Finance; 1.1 Financial Planning & Budgeting; 1.2 Financial Accounting & Reporting; 1.3 Treasury & Cash Management; 1.4 Payments & Receivables; 1.5 Financial Control & Audit Support |
| 2 Human Resources | 2 Human Resources; 2.1 Workforce Planning; 2.2 Recruitment & Onboarding; 2.3 Learning & Development; 2.4 Pay, Reward & Pensions; 2.5 Employee Relations & Wellbeing |
| 3 Procurement | 3 Procurement; 3.1 Category & Sourcing Strategy; 3.2 Tendering & Contract Award; 3.3 Contract & Supplier Management; 3.4 Spend Control & Compliance |
| 4 Information Management | 4 Information Management; 4.1 Records Management; 4.2 Data Governance & Quality; 4.3 Information Rights & Access; 4.4 Data Protection & Privacy; 4.5 Analytics & Business Intelligence |
| 5 Customer Contact | 5.2 Identity & Account Verification; 5.5 Accessibility & Inclusion |
| 6 Estates | 6 Estates; 6.1 Property Portfolio & Strategy; 6.2 Facilities & Building Operations; 6.3 Maintenance & Compliance; 6.4 Space & Workplace; 6.5 Energy & Sustainability |
| 7 Digital & Technology | 7 Digital & Technology; 7.1 Enterprise Architecture & Standards; 7.2 Application Delivery & Support; 7.3 Infrastructure, Cloud & Networks; 7.4 Cyber Security & Resilience; 7.5 Digital Service Design; 7.6 Technology Service Management |
| 8 Governance & Assurance | 8 Governance & Assurance; 8.1 Strategy & Performance; 8.2 Risk Management; 8.3 Internal Audit & Assurance; 8.4 Legal & Regulatory Compliance; 8.5 Corporate Governance; 8.6 Business Continuity & Emergency Planning |
| 10 Network Operations | 10 Network Operations; 10.3 Emergency Response; 10.4 Distribution System Operation |
| 11 Customer & Metering | 11 Customer & Metering; 11.2 Priority Services Register; 11.3 Guaranteed Standards Payments |
| 12 Regulatory Compliance & Price-Control Reporting | 12 Regulatory Compliance & Price-Control Reporting; 12.1 Ofgem Regulatory Reporting; 12.2 RIIO Price-Control Business Plan; 12.3 Interruptions Incentive Reporting; 12.4 Network Access & Charging; 12.5 Industry Codes Compliance; 12.6 Health, Safety & Environment |
| 13 Network Delivery & Maintenance | 13 Network Delivery & Maintenance; 13.4 Streetworks & Permits; 13.5 Land, Wayleaves & Consents |

## Any organisation

**Version:** 2 · **Pinned map:** v2 · **Entries:** 12 · **Coverage:** 38 of 70 capabilities · **Pending review:** 12 of 12 entries

**Description:** Version 2, checked 25 November 2026. It corrects the Workday mapping from Digital & Technology to the HR capabilities it actually serves, adds customer-contact and case-tracking links to the CRM entries, adds strategy and risk links to Planview, corrects the Miro claim and mapping, and adds reviewed-candidate products for the main corporate gaps. Every new or changed claim is Pending review until a named reviewer signs it. Coverage is a first slice, not an exhaustive market survey.

### Coverage

| Code | Capability | Products |
| --- | --- | --- |
| 1 | Finance | Oracle Fusion Cloud Financial Management |
| 1.1 | Financial Planning & Budgeting | Oracle Fusion Cloud Financial Management |
| 1.2 | Financial Accounting & Reporting | Oracle Fusion Cloud Financial Management |
| 1.4 | Payments & Receivables | Oracle Fusion Cloud Financial Management |
| 1.5 | Financial Control & Audit Support | Oracle Fusion Cloud Financial Management |
| 2 | Human Resources | Workday Human Capital Management |
| 2.1 | Workforce Planning | Workday Human Capital Management |
| 2.2 | Recruitment & Onboarding | Workday Human Capital Management |
| 2.3 | Learning & Development | Workday Human Capital Management |
| 2.4 | Pay, Reward & Pensions | Workday Human Capital Management |
| 2.5 | Employee Relations & Wellbeing | Workday Human Capital Management |
| 4.1 | Records Management | Microsoft Purview |
| 4.2 | Data Governance & Quality | Microsoft Purview |
| 4.3 | Information Rights & Access | Microsoft Purview |
| 4.4 | Data Protection & Privacy | Microsoft Purview |
| 4.5 | Analytics & Business Intelligence | Power BI |
| 5 | Customer Contact | ServiceNow Customer Service Management; Microsoft Dynamics 365 Customer Service |
| 5.3 | Case & Request Tracking | ServiceNow Customer Service Management; Microsoft Dynamics 365 Customer Service |
| 5.4 | Complaints & Feedback | ServiceNow Customer Service Management; Microsoft Dynamics 365 Customer Service |
| 6 | Estates | Planon Integrated Workplace Management Solution |
| 6.1 | Property Portfolio & Strategy | Planon Integrated Workplace Management Solution |
| 6.2 | Facilities & Building Operations | Planon Integrated Workplace Management Solution |
| 6.3 | Maintenance & Compliance | Planon Integrated Workplace Management Solution |
| 6.4 | Space & Workplace | Planon Integrated Workplace Management Solution |
| 6.5 | Energy & Sustainability | Planon Integrated Workplace Management Solution |
| 7.2 | Application Delivery & Support | Jira Service Management |
| 7.6 | Technology Service Management | Jira Service Management |
| 8.1 | Strategy & Performance | Planview AdaptiveWork |
| 8.2 | Risk Management | Planview AdaptiveWork |
| 9.1 | Understanding Needs | Qualtrics XM |
| 9.2 | Engagement & Communications | Qualtrics XM |
| 9.3 | Relationship Management | ServiceNow Customer Service Management; Microsoft Dynamics 365 Customer Service |
| 9.4 | Feedback & Insight | Qualtrics XM |
| 10.1 | Service Design | Miro |
| 11.1 | Work Planning & Scheduling | Microsoft Dynamics 365 Field Service |
| 11.2 | Service Delivery | Microsoft Dynamics 365 Field Service |
| 12.1 | Portfolio & Programme Management | Planview AdaptiveWork |
| 12.2 | Business Analysis & Design | Miro |

### Entries

#### 1. ServiceNow Customer Service Management — ServiceNow

`servicenow-customer-service-management` · **claims pending review**

Customer service case management and self-service software.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 5 | Customer Contact | Handles customer contact and service requests across channels. |
| 5.3 | Case & Request Tracking | Tracks customer cases and requests with an owner and history. |
| 5.4 | Complaints & Feedback | Records complaints and feedback as service cases. |
| 9.3 | Relationship Management | Maintains the customer record and service history. |

**Claims**

- **functional.** The vendor describes ServiceNow Customer Service Management as customer service case management and self-service software.
  - Source: [https://www.servicenow.com/uk/products/customer-service-management.html](https://www.servicenow.com/uk/products/customer-service-management.html) — checked 2026-11-21
  - Reviewer: Pending review — 2026-11-21

#### 2. Microsoft Dynamics 365 Customer Service — Microsoft

`microsoft-dynamics-365-customer-service` · **claims pending review**

Customer service and case management software.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 5 | Customer Contact | Holds customer contact and service cases across channels. |
| 5.3 | Case & Request Tracking | Tracks customer requests as cases with an owner and history. |
| 5.4 | Complaints & Feedback | Records complaints and feedback as cases. |
| 9.3 | Relationship Management | Maintains the customer record and service history. |

**Claims**

- **functional.** The vendor describes Microsoft Dynamics 365 Customer Service as customer service and case management software.
  - Source: [https://www.microsoft.com/en-gb/dynamics-365/products/customer-service](https://www.microsoft.com/en-gb/dynamics-365/products/customer-service) — checked 2026-11-25
  - Reviewer: Pending review — 2026-11-25

#### 3. Microsoft Dynamics 365 Field Service — Microsoft

`microsoft-dynamics-365-field-service` · **claims pending review**

Field work scheduling and service management software.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 11.1 | Work Planning & Scheduling | Schedules work and assigns it to field teams |
| 11.2 | Service Delivery | Supports field delivery and completion records |

**Claims**

- **functional.** The vendor describes Microsoft Dynamics 365 Field Service as field work scheduling and service management software.
  - Source: [https://www.microsoft.com/en-us/dynamics-365/products/field-service](https://www.microsoft.com/en-us/dynamics-365/products/field-service) — checked 2026-11-21
  - Reviewer: Pending review — 2026-11-21

#### 4. Planview AdaptiveWork — Planview

`planview-adaptivework` · **claims pending review**

AI-powered portfolio, project and work management software.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 8.1 | Strategy & Performance | Connects goals and strategy to portfolios, plans and delivery. |
| 8.2 | Risk Management | Tracks project risks and issues in a risk register. |
| 12.1 | Portfolio & Programme Management | Plans projects and tracks portfolio delivery. |

**Claims**

- **functional.** The vendor describes Planview AdaptiveWork as AI-powered portfolio and work management software.
  - Source: [https://www.planview.com/products-solutions/products/adaptivework/](https://www.planview.com/products-solutions/products/adaptivework/) — checked 2026-11-25
  - Reviewer: Pending review — 2026-11-25

#### 5. Workday Human Capital Management — Workday

`workday-human-capital-management` · **claims pending review**

Human capital management software for core HR, workforce planning, talent, learning, pay and employee experience.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 2 | Human Resources | Runs core HR data and employment processes. |
| 2.1 | Workforce Planning | Models, forecasts and budgets the workforce. |
| 2.2 | Recruitment & Onboarding | Manages the talent acquisition lifecycle and onboarding. |
| 2.3 | Learning & Development | Supports learning, skills and talent development. |
| 2.4 | Pay, Reward & Pensions | Supports payroll, compensation and benefits. |
| 2.5 | Employee Relations & Wellbeing | Supports employee voice, engagement and wellbeing. |

**Claims**

- **functional.** The vendor describes Workday Human Capital Management as a suite of HR solutions for core HR, workforce planning, talent, learning, pay and employee experience.
  - Source: [https://www.workday.com/en-gb/products/human-capital-management/overview.html](https://www.workday.com/en-gb/products/human-capital-management/overview.html) — checked 2026-11-25
  - Reviewer: Pending review — 2026-11-25

#### 6. Miro — Miro

`miro` · **claims pending review**

An AI-powered visual workspace for collaboration, workshops and process mapping.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 10.1 | Service Design | Supports collaborative service design and customer journey workshops. |
| 12.2 | Business Analysis & Design | Supports process mapping and design workshops. |

**Claims**

- **functional.** The vendor describes Miro as an AI-powered visual workspace for collaboration, workshops and process mapping.
  - Source: [https://miro.com/](https://miro.com/) — checked 2026-11-25
  - Reviewer: Pending review — 2026-11-25

#### 7. Oracle Fusion Cloud Financial Management — Oracle

`oracle-fusion-financials` · **claims pending review**

Financial management software for accounting, planning, payments, reporting and controls.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 1 | Finance | Runs core financial management processes. |
| 1.1 | Financial Planning & Budgeting | Supports planning and budgeting. |
| 1.2 | Financial Accounting & Reporting | Supports accounting and financial reporting. |
| 1.4 | Payments & Receivables | Supports payments and receivables. |
| 1.5 | Financial Control & Audit Support | Supports financial controls and audit. |

**Claims**

- **functional.** The vendor describes Oracle Fusion Cloud Financial Management as financial management software for AI-driven automation, real-time insights and global compliance.
  - Source: [https://www.oracle.com/erp/financials/](https://www.oracle.com/erp/financials/) — checked 2026-11-25
  - Reviewer: Pending review — 2026-11-25

#### 8. Microsoft Purview — Microsoft

`microsoft-purview` · **claims pending review**

A unified data security, governance and compliance platform for discovering, classifying and protecting sensitive data.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 4.1 | Records Management | Retains and manages records through their lifecycle. |
| 4.2 | Data Governance & Quality | Discovers and classifies data across the estate. |
| 4.3 | Information Rights & Access | Controls access and protects sensitive information. |
| 4.4 | Data Protection & Privacy | Supports data loss prevention and compliance. |

**Claims**

- **functional.** The vendor describes Microsoft Purview as a unified data security, governance and compliance platform for discovering, classifying and protecting sensitive data.
  - Source: [https://www.microsoft.com/en-us/security/business/microsoft-purview](https://www.microsoft.com/en-us/security/business/microsoft-purview) — checked 2026-11-25
  - Reviewer: Pending review — 2026-11-25

#### 9. Power BI — Microsoft

`microsoft-power-bi` · **claims pending review**

A business intelligence platform for visualising data and sharing interactive reports and dashboards.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 4.5 | Analytics & Business Intelligence | Visualises data and shares interactive reports and dashboards. |

**Claims**

- **functional.** The vendor describes Power BI as a unified analytics platform for visualising data and sharing interactive reports.
  - Source: [https://www.microsoft.com/en-us/power-platform/products/power-bi](https://www.microsoft.com/en-us/power-platform/products/power-bi) — checked 2026-11-25
  - Reviewer: Pending review — 2026-11-25

#### 10. Planon Integrated Workplace Management Solution — Planon

`planon-iwms` · **claims pending review**

Integrated workplace and real estate management software for real estate, space, maintenance and sustainability.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 6 | Estates | Manages real estate, facilities and workplace services. |
| 6.1 | Property Portfolio & Strategy | Manages real estate portfolios and strategy. |
| 6.2 | Facilities & Building Operations | Runs facilities and building operations. |
| 6.3 | Maintenance & Compliance | Plans asset maintenance and compliance. |
| 6.4 | Space & Workplace | Manages space and workplace services. |
| 6.5 | Energy & Sustainability | Supports energy and sustainability management. |

**Claims**

- **functional.** The vendor describes Planon as integrated workplace and real estate management software for real estate, space, maintenance and sustainability.
  - Source: [https://www.planonsoftware.com/](https://www.planonsoftware.com/) — checked 2026-11-25
  - Reviewer: Pending review — 2026-11-25

#### 11. Qualtrics XM — Qualtrics

`qualtrics-xm` · **claims pending review**

An experience management platform for understanding customers and employees and acting on their feedback.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 9.1 | Understanding Needs | Collects experience data to understand customer and employee needs. |
| 9.2 | Engagement & Communications | Supports engagement and feedback across channels. |
| 9.4 | Feedback & Insight | Turns feedback into insight and action. |

**Claims**

- **functional.** The vendor describes Qualtrics as an experience management platform for understanding customers and employees and acting on their feedback.
  - Source: [https://www.qualtrics.com/](https://www.qualtrics.com/) — checked 2026-11-25
  - Reviewer: Pending review — 2026-11-25

#### 12. Jira Service Management — Atlassian

`atlassian-jsm` · **claims pending review**

An AI-powered service management platform for IT, HR, facilities and other teams to manage requests and incidents.

| Code | Capability | How it supports it |
| --- | --- | --- |
| 7.2 | Application Delivery & Support | Connects development and operations teams to support delivery. |
| 7.6 | Technology Service Management | Manages service requests, incidents and changes. |

**Claims**

- **functional.** The vendor describes Jira Service Management as an AI-powered service management platform for IT, HR, facilities and other teams to manage requests and incidents.
  - Source: [https://www.atlassian.com/software/jira/service-management](https://www.atlassian.com/software/jira/service-management) — checked 2026-11-25
  - Reviewer: Pending review — 2026-11-25

### Still uncovered

32 of 70 capabilities have no product.

| Area | Uncovered capabilities |
| --- | --- |
| 1 Finance | 1.3 Treasury & Cash Management |
| 3 Procurement | 3 Procurement; 3.1 Category & Sourcing Strategy; 3.2 Tendering & Contract Award; 3.3 Contract & Supplier Management; 3.4 Spend Control & Compliance |
| 4 Information Management | 4 Information Management |
| 5 Customer Contact | 5.1 Contact Channels; 5.2 Identity & Account Verification; 5.5 Accessibility & Inclusion |
| 7 Digital & Technology | 7 Digital & Technology; 7.1 Enterprise Architecture & Standards; 7.3 Infrastructure, Cloud & Networks; 7.4 Cyber Security & Resilience; 7.5 Digital Service Design |
| 8 Governance & Assurance | 8 Governance & Assurance; 8.3 Internal Audit & Assurance; 8.4 Legal & Regulatory Compliance; 8.5 Corporate Governance; 8.6 Business Continuity & Emergency Planning |
| 9 Customers & Stakeholders | 9 Customers & Stakeholders |
| 10 Products & Services | 10 Products & Services; 10.2 Service Portfolio Management; 10.3 Pricing & Funding Models; 10.4 Quality Standards & Specifications |
| 11 Delivery & Operations | 11 Delivery & Operations; 11.3 Supply & Partner Coordination; 11.4 Performance & Quality Monitoring |
| 12 Change & Improvement | 12 Change & Improvement; 12.3 Benefits Realisation; 12.4 Organisational Change; 12.5 Continuous Improvement |

## How to read the review state

- **Pending review** means the claim has not been signed by a named person. The review script refuses to publish a catalogue containing one.
- **Claims reviewed** means a named reviewer and date are recorded. The person, not the tool, is accountable for the claim.
- A product on this list is a candidate, not a recommendation. The catalogue records what the vendor says, not whether the product is suitable, deployed, accessible, secure or compliant.
- A `403` or timeout on a vendor page is not proof the page is broken. Open it in a browser before removing an entry.

## What this draft still needs

1. A named reviewer to sign every `Pending review` claim, starting with the electricity entries because that catalogue is the one users can see once published.
2. A decision on the uncovered capabilities listed above: add a product, or record that no suitable product was found.
3. A live browser check for the pages that block scripts: ServiceNow, SAP, Coupa and the Schneider product page.
4. Load and publish through the catalogue review/load/publish flow; do not hand-insert published rows.


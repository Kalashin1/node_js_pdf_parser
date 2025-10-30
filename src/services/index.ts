import PdfParse from "pdf-parse";
import { v2 } from "@google-cloud/translate";

const _translate = new v2.Translate({
  projectId: "",
  key: "",
});

export class PDFParser {
  private text: string;
  readonly options = {
    pagerender: this.render_page,
  };

  async parseFile(file: Buffer) {
    const parsedText = await PdfParse(file, this.options);
    const [text] = await _translate.translate(parsedText.text, {
      from: "de",
      to: "en",
    });

    this.text = text;

    const projectDetails = this.getProjectDetails(this.text).join("\n");
    const external_id = projectDetails.slice(
      7,
      projectDetails.indexOf("Start", 7)
    );

    const construction_manager = this.getCommissioner(this.text);
    const dates = this.extractProjectDates(this.text);
    const building = this.getBuilding(this.text);
    const constructionSchedule = this.getConstructionSchedule(this.text);
    const splitPages = this.splitTextIntoPages(this.text);
    const mainPositions = this.getOrderItems(this.text);

    const _mainPositions: any[] = mainPositions.map((position) =>
      this.parseLineToPosition(position)
    );

    const payload = {
      text: this.text,
      projectDetails,
      external_id,
      startDate: dates.startDate,
      completionDate: dates.completionDate,
      construction_manager,
      ...building,
      constructionSchedule,
      splitPages,
      positions: _mainPositions,
    };
    console.log("response", payload);
    return payload;
  }

  getBuilding(text: string) {
    const lines = text.split("\n");

    let isBuildingDetails = false;

    const buildingDetails = [];

    for (const line of lines) {
      if (
        line &&
        (line.includes("Building object") ||
          line.includes("Building Object") ||
          line.includes("Construction object") ||
          line.includes("Construction Object") ||
          line.includes("Building Project") ||
          line.includes("building project") ||
          line.includes("building Project") ||
          line.includes("Construction Project"))
      ) {
        isBuildingDetails = true;
        continue;
      }

      if (isBuildingDetails) buildingDetails.push(line);

      if (
        (line && line.includes("Company")) ||
        line.includes("Companies") ||
        line.includes("company") ||
        line.includes("companies")
      ) {
        isBuildingDetails = false;
        break;
      }
    }
    const buildingText = buildingDetails.join("");
    return {
      building: {
        apartmentId: buildingText.slice(
          buildingText.indexOf("Apartment ID") + String("Apartment ID").length,
          buildingText.indexOf("Address")
        ),
        address: buildingText.slice(
          buildingText.indexOf("Address") + String("Address").length,
          buildingText.includes("LocationLocation:")
            ? buildingText.indexOf("LocationLocation:")
            : buildingText.indexOf("Location") + 1
          // ? buildingText.indexOf("Location2")
          // : buildingText.indexOf("Location1")
        ),
        location: buildingText.slice(
          buildingText.includes("Location Location:")
            ? buildingText.indexOf("Location Location:") +
                String("Location Location:").length
            : buildingText.includes("Location")
            ? buildingText.indexOf("Location") + String("Location1").length
            : buildingText.indexOf("Location") + String("Location").length,
          buildingText.includes("Rental status")
            ? buildingText.indexOf("Rental status")
            : buildingText.indexOf("Details")
        ),
        description: buildingText.slice(
          buildingText.indexOf("Details") + +String("Details").length,
          buildingText.indexOf("Notes")
        ),
        notes: buildingText.slice(
          buildingText.indexOf("Notes") + 1 + String("Notes").length,
          buildingText.includes("Created on")
            ? buildingText.indexOf("Created on")
            : buildingText.indexOf("Company")
        ),
      },
      rentalStatus: buildingText.includes("Rental status")
        ? buildingText.slice(
            buildingText.indexOf("Rental status") +
              1 +
              String("Rental status").length,
            buildingText.indexOf("Details")
          )
        : "empty",
    };
  }

  splitTextIntoPages(text) {
    // Regex to match page indicators like "1/3", "2/3", "1 / 3", etc.
    const pageIndicatorRegex = /(\s+\d+\s*\/\s*\d+\s+)/g;

    // Find all page indicators and their positions
    const pageIndicators = [];
    let match;
    while ((match = pageIndicatorRegex.exec(text)) !== null) {
      pageIndicators.push({
        indicator: match[0],
        index: match.index,
        length: match[0].length,
      });
    }

    // If no page indicators found, return the entire text as one page
    if (pageIndicators.length === 0) {
      return [text.trim()];
    }

    // Split the text into pages based on the page indicators
    const pages = [];
    let startIndex = 0;

    for (let i = 0; i < pageIndicators.length; i++) {
      const pageIndicator = pageIndicators[i];
      const pageEndIndex = pageIndicator.index + pageIndicator.length;

      // Extract the page content including the page indicator
      const pageContent = text.substring(startIndex, pageEndIndex).trim();
      if (pageContent) {
        pages.push(pageContent);
      }

      // Update the start index for the next page
      startIndex = pageEndIndex;
    }

    // Add the remaining content as the last page (if any)
    const remainingContent = text.substring(startIndex).trim();
    if (remainingContent) {
      pages.push(remainingContent);
    }

    return pages;
  }

  getOrderItems(text?: string) {
    const lines = text
      ? text.split(/\n|\[object Object\]/)
      : this.text.split(/\n|\[object Object\]/);
    const positions = [];
    let isPositions = false;

    const regex = new RegExp(/^\d{2,4}\.\d{2,4}\.\d{2}\.\d{4}$/);

    for (const line of lines) {
      if (
        line.includes("Main order items") ||
        line.includes("Main Order Items") ||
        line.includes("Main contract items") ||
        line.includes("Main Contract Items")
      ) {
        isPositions = true;
        continue;
      }

      if (
        line.includes("Addendum")
        //|| line.includes("See chat history")
      )
        break;
      if (line.includes("Powered by TCPDF")) break;

      if (isPositions && regex.test(line.slice(0, 15))) {
        positions.push(line);
      }

      if (isPositions && !regex.test(line.slice(0, 15))) {
        positions[positions.length - 1] += line;
      }
    }

    return positions;
  }

  validPlaces = [
    "Toilet",
    "Bathroom",
    "Kitchen",
    "Hallway",
    "Apartment",
    "Room",
    "Living room",
    "Vedroom",
    "Children's room",
    "Nursery",
    "Entrance",
    "Storage room",
    "Balcony",
    "Bedroom",
  ];

  parseLineToPosition(string: string) {
    const units = ["psch", "pcs", "pc", "pk", "in", "cm", "mm", "Unit"];

    const unitRegex = new RegExp(
      `(${units.join("|")})(\\d[\\d,]*\\.\\d{2,3})`,
      "i"
    );
    const _match = string.match(unitRegex);
    // If we found a unit directly followed by a price without €, add the € symbol
    if (_match) {
      const unit = _match[1];
      const price = _match[2];
      string = string.replace(unit + price, unit + " €" + price);
    }

    console.log("string", string);

    let match: RegExpExecArray;
    const pattern =
      /(\d{2,4}\.\d{2,4}\.\d{2}\.\d{4}).*?(\d+\.\d{2})\s*([a-zA-Z]+\.?)\s*(€?\s*[\d,]+\.\d{2,3})(?:\s*(€?\s*[\d,]+\.\d{2,3}))?/;

    match = pattern.exec(string);
    // console.log("match", match)

    if (!match) {
      const productIdPattern = /^(\d{2,4}\.\d{2,4}\.\d{2}\.\d{4})/;
      match = productIdPattern.exec(string);
    }

    if (match) {
      return {
        id: match[1],
        crowd: match[2] ?? "1.00",
        section: this.validPlaces.filter((pl) => string.includes(pl)),
        originalPrice: this.parsePrice(match[4]?.slice(1)) ?? 0,
        units: match[3] ?? "",
      };
    }
  }

  getConstructionSchedule(text) {
    const lines = text.split("\n");
    let isScheduleSection = false;
    const scheduleEntries = [];

    for (const line of lines) {
      // Check if we've found the schedule section
      if (
        line &&
        (line.includes("Schedule by Trade") ||
          line.includes("Schedule by trade"))
      ) {
        isScheduleSection = true;
        continue;
      }

      // If we're in the schedule section, process the lines
      if (isScheduleSection) {
        // Stop processing if we hit the end of the schedule section
        if (line.trim() === "" && scheduleEntries.length > 0) {
          // If we have entries and hit an empty line, we might be at the end
          break;
        }

        // Check if the line contains a trade entry
        // Format: "Trade Name (i) startDate - endDate"
        const tradeMatch = line.match(/(.*?)\s*\(i\)\s*(.*?)\s*-\s*(.*)/);
        if (tradeMatch) {
          const trade = tradeMatch[1].trim();
          const startDate = tradeMatch[2].trim();
          const endDate = tradeMatch[3].trim();

          scheduleEntries.push({
            trade,
            startDate,
            endDate,
          });
        } else {
          // Check if it's a continuation line with just dates (like for Carpenter)
          const dateOnlyMatch = line.match(/(.*?)\s*-\s*(.*)/);
          if (dateOnlyMatch && scheduleEntries.length > 0) {
            // Use the previous trade for this date range
            const prevTrade = scheduleEntries[scheduleEntries.length - 1].trade;
            const startDate = dateOnlyMatch[1].trim();
            const endDate = dateOnlyMatch[2].trim();

            scheduleEntries.push({
              trade: prevTrade,
              startDate,
              endDate,
            });
          }
        }
      }

      // Stop processing if we hit the next major section
      if (
        isScheduleSection &&
        (line.includes("Main Order Items") || line.includes("Main order items"))
      ) {
        break;
      }
    }

    return scheduleEntries;
  }

  parsePrice(priceString) {
    if (!priceString) return null;

    // Remove euro sign, commas, and any whitespace
    const numericString = priceString
      .replace(/€/g, "")
      .replace(/,/g, "")
      .trim();

    // Convert to number
    const numberValue = parseFloat(numericString);

    // Return null if conversion failed (NaN)
    return isNaN(numberValue) ? null : numberValue;
  }

  getProjectDetails(text: string) {
    const lines = text.split("\n");

    const projectDetails = [];

    let isProjectDetails = false;

    for (const line of lines) {
      if (
        line &&
        (line.includes("Project Data") || line.includes("Project data"))
      ) {
        isProjectDetails = true;
        continue;
      }

      if (line.includes("Project status") || line.includes("Project Status")) {
        isProjectDetails = false;
        break;
      }

      if (isProjectDetails) {
        projectDetails.push(line);
      }
    }

    return projectDetails;
  }

  getCommissioner(text: string) {
    const lines = text.split("\n");
    let name = "";
    let phone = "";
    let foundManager = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lowerLine = line.toLowerCase();

      if (lowerLine.includes("construction manager")) {
        foundManager = true;

        // Extract name from current line
        const managerMatch = line.match(/construction manager[:\s]*(.*)/i);
        if (managerMatch) {
          name = managerMatch[1].trim();

          // Check if phone is in the same line
          const phoneInLine = name.match(
            /(.*?)(?:\s+)(?:phone|tel|telephone)[:\s]*([+\d\s\-()]+)/i
          );
          if (phoneInLine) {
            name = phoneInLine[1].trim();
            phone = phoneInLine[2].trim();
          } else {
            // Look for phone in next line if not found in current line
            if (i + 1 < lines.length) {
              const nextLine = lines[i + 1].trim();
              const phoneMatch = nextLine.match(
                /(?:phone|tel|telephone)[:\s]*([+\d\s\-()]+)/i
              );
              if (phoneMatch) {
                phone = phoneMatch[1].trim();
              }
            }
          }
        }
        break;
      }
    }

    // Clean up the name (remove any trailing phone-related text)
    if (name) {
      name = name.replace(/\s*(?:phone|tel|telephone).*$/i, "").trim();
    }

    return { name, phone };
  }

  extractProjectDates(text) {
    // Regular expressions to match dates in DD.MM.YYYY format
    const dateRegex = /\b(\d{1,2}\.\d{1,2}\.\d{4})\b/g;

    // Find all dates in the text
    const dates = text.match(dateRegex) || [];

    // Look for start and completion indicators
    const startMatch = text.match(/Start:\s*(\d{1,2}\.\d{1,2}\.\d{4})/i);
    const completionMatch = text.match(
      /(?:Completion|Complete):\s*(\d{1,2}\.\d{1,2}\.\d{4})/i
    );

    let startDate = null;
    let completionDate = null;

    // Extract start date
    if (startMatch) {
      startDate = startMatch[1];
    } else if (dates.length >= 1) {
      // If no explicit start indicator, assume first date is start date
      startDate = dates[0];
    }

    // Extract completion date
    if (completionMatch) {
      completionDate = completionMatch[1];
    } else if (dates.length >= 2) {
      // If no explicit completion indicator, assume second date is completion date
      completionDate = dates[1];
    }

    return {
      startDate: startDate,
      completionDate: completionDate,
      datesFound: dates,
    };
  }

  render_page(pageData) {
    let render_options = {
      normalizeWhitespace: false,
      disableCombineTextItems: true,
    };

    return pageData.getTextContent(render_options).then(function (textContent) {
      let lastY,
        text = {};
      for (let item of textContent.items) {
        if (lastY == item.transform[5] || !lastY) {
          text += item.str;
        } else {
          text += "\n" + item.str;
        }
        lastY = item.transform[5];
      }
      return text;
    });
  }
}

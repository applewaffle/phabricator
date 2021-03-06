/**
 * @provides javelin-workboard-board
 * @requires javelin-install
 *           javelin-dom
 *           javelin-util
 *           javelin-stratcom
 *           javelin-workflow
 *           phabricator-draggable-list
 *           javelin-workboard-column
 *           javelin-workboard-header-template
 * @javelin
 */

JX.install('WorkboardBoard', {

  construct: function(controller, phid, root) {
    this._controller = controller;
    this._phid = phid;
    this._root = root;

    this._templates = {};
    this._orderMaps = {};
    this._propertiesMap = {};
    this._headers = {};
    this._buildColumns();
  },

  properties: {
    order: null,
    pointsEnabled: false
  },

  members: {
    _controller: null,
    _phid: null,
    _root: null,
    _columns: null,
    _templates: null,
    _orderMaps: null,
    _propertiesMap: null,
    _headers: null,

    getRoot: function() {
      return this._root;
    },

    getColumns: function() {
      return this._columns;
    },

    getColumn: function(k) {
      return this._columns[k];
    },

    getPHID: function() {
      return this._phid;
    },

    setCardTemplate: function(phid, template)  {
      this._templates[phid] = template;
      return this;
    },

    getHeaderTemplate: function(header_key) {
      if (!this._headers[header_key]) {
        this._headers[header_key] = new JX.WorkboardHeaderTemplate(header_key);
      }

      return this._headers[header_key];
    },

    getHeaderTemplatesForOrder: function(order) {
      var templates = [];

      for (var k in this._headers) {
        var header = this._headers[k];

        if (header.getOrder() !== order) {
          continue;
        }

        templates.push(header);
      }

      templates.sort(JX.bind(this, this._sortHeaderTemplates));

      return templates;
    },

    _sortHeaderTemplates: function(u, v) {
      return this.compareVectors(u.getVector(), v.getVector());
    },

    setObjectProperties: function(phid, properties) {
      this._propertiesMap[phid] = properties;
      return this;
    },

    getObjectProperties: function(phid) {
      return this._propertiesMap[phid];
    },

    getCardTemplate: function(phid) {
      return this._templates[phid];
    },

    getController: function() {
      return this._controller;
    },

    setOrderMap: function(phid, map) {
      this._orderMaps[phid] = map;
      return this;
    },

    getOrderVector: function(phid, key) {
      return this._orderMaps[phid][key];
    },

    compareVectors: function(u_vec, v_vec) {
      for (var ii = 0; ii < u_vec.length; ii++) {
        if (u_vec[ii] > v_vec[ii]) {
          return 1;
        }

        if (u_vec[ii] < v_vec[ii]) {
          return -1;
        }
      }

      return 0;
    },

    start: function() {
      this._setupDragHandlers();

      for (var k in this._columns) {
        this._columns[k].redraw();
      }
    },

    _buildColumns: function() {
      var nodes = JX.DOM.scry(this.getRoot(), 'ul', 'project-column');

      this._columns = {};
      for (var ii = 0; ii < nodes.length; ii++) {
        var node = nodes[ii];
        var data = JX.Stratcom.getData(node);
        var phid = data.columnPHID;

        this._columns[phid] = new JX.WorkboardColumn(this, phid, node);
      }
    },

    _setupDragHandlers: function() {
      var columns = this.getColumns();

      var lists = [];
      for (var k in columns) {
        var column = columns[k];

        var list = new JX.DraggableList('project-card', column.getRoot())
          .setOuterContainer(this.getRoot())
          .setFindItemsHandler(JX.bind(column, column.getDropTargetNodes))
          .setCanDragX(true)
          .setHasInfiniteHeight(true)
          .setIsDropTargetHandler(JX.bind(column, column.setIsDropTarget));

        var default_handler = list.getGhostHandler();
        list.setGhostHandler(
          JX.bind(column, column.handleDragGhost, default_handler));

        if (this.getOrder() !== 'natural') {
          list.setCompareHandler(JX.bind(column, column.compareHandler));
        }

        list.listen('didDrop', JX.bind(this, this._onmovecard, list));

        lists.push(list);
      }

      for (var ii = 0; ii < lists.length; ii++) {
        lists[ii].setGroup(lists);
      }
    },

    _findCardsInColumn: function(column_node) {
      return JX.DOM.scry(column_node, 'li', 'project-card');
    },

    _onmovecard: function(list, item, after_node, src_list) {
      list.lock();
      JX.DOM.alterClass(item, 'drag-sending', true);

      var src_phid = JX.Stratcom.getData(src_list.getRootNode()).columnPHID;
      var dst_phid = JX.Stratcom.getData(list.getRootNode()).columnPHID;

      var item_phid = JX.Stratcom.getData(item).objectPHID;
      var data = {
        objectPHID: item_phid,
        columnPHID: dst_phid,
        order: this.getOrder()
      };

      var after_data;
      var after_card = after_node;
      while (after_card) {
        after_data = JX.Stratcom.getData(after_card);
        if (after_data.objectPHID) {
          break;
        }
        after_card = after_card.previousSibling;
      }

      if (after_data) {
        data.afterPHID = after_data.objectPHID;
      }

      var before_data;
      var before_card = item.nextSibling;
      while (before_card) {
        before_data = JX.Stratcom.getData(before_card);
        if (before_data.objectPHID) {
          break;
        }
        before_card = before_card.nextSibling;
      }

      if (before_data) {
        data.beforePHID = before_data.objectPHID;
      }

      var header_key = JX.Stratcom.getData(after_node).headerKey;
      if (header_key) {
        var properties = this.getHeaderTemplate(header_key)
          .getEditProperties();
        data.header = JX.JSON.stringify(properties);
      }

      var visible_phids = [];
      var column = this.getColumn(dst_phid);
      for (var object_phid in column.getCards()) {
        visible_phids.push(object_phid);
      }

      data.visiblePHIDs = visible_phids.join(',');

      var onupdate = JX.bind(
        this,
        this._oncardupdate,
        list,
        src_phid,
        dst_phid,
        data.afterPHID);

      new JX.Workflow(this.getController().getMoveURI(), data)
        .setHandler(onupdate)
        .start();
    },

    _oncardupdate: function(list, src_phid, dst_phid, after_phid, response) {
      var src_column = this.getColumn(src_phid);
      var dst_column = this.getColumn(dst_phid);

      var card = src_column.removeCard(response.objectPHID);
      dst_column.addCard(card, after_phid);

      src_column.markForRedraw();
      dst_column.markForRedraw();

      this.updateCard(response);

      list.unlock();
    },

    updateCard: function(response, options) {
      options = options || {};
      options.dirtyColumns = options.dirtyColumns || {};

      var columns = this.getColumns();

      var phid = response.objectPHID;

      if (!this._templates[phid]) {
        for (var add_phid in response.columnMaps) {
          var target_column = this.getColumn(add_phid);

          if (!target_column) {
            // If the column isn't visible, don't try to add a card to it.
            continue;
          }

          target_column.newCard(phid);
        }
      }

      this.setCardTemplate(phid, response.cardHTML);

      var order_maps = response.orderMaps;
      for (var order_phid in order_maps) {
        this.setOrderMap(order_phid, order_maps[order_phid]);
      }

      var column_maps = response.columnMaps;
      var natural_column;
      for (var natural_phid in column_maps) {
        natural_column = this.getColumn(natural_phid);
        if (!natural_column) {
          // Our view of the board may be out of date, so we might get back
          // information about columns that aren't visible. Just ignore the
          // position information for any columns we aren't displaying on the
          // client.
          continue;
        }

        natural_column.setNaturalOrder(column_maps[natural_phid]);
      }

      var property_maps = response.propertyMaps;
      for (var property_phid in property_maps) {
        this.setObjectProperties(property_phid, property_maps[property_phid]);
      }

      for (var column_phid in columns) {
        var column = columns[column_phid];

        var cards = column.getCards();
        for (var object_phid in cards) {
          if (object_phid !== phid) {
            continue;
          }

          var card = cards[object_phid];
          card.redraw();

          column.markForRedraw();
        }
      }

      this._redrawColumns();
    },

    _redrawColumns: function() {
      var columns = this.getColumns();
      for (var k in columns) {
        if (columns[k].isMarkedForRedraw()) {
          columns[k].redraw();
        }
      }
    }

  }

});
